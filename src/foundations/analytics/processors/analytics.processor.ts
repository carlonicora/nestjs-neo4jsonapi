import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject } from "@nestjs/common";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { ANALYTICS_CONFIG, AnalyticsModuleConfig } from "../interfaces/analytics.config.interface";
import { AnalyticsPageViewInput } from "../interfaces/analytics.page-view.input";
import { ANALYTICS_PURGE_JOB_SUFFIX, AnalyticsPurgeVisitorInput } from "../interfaces/analytics.purge-visitor.input";
import { AnalyticsResolvedPageView } from "../interfaces/analytics.resolved-page-view";
import { AnalyticsSessionRepository } from "../repositories/analytics-session.repository";
import { AnalyticsVisitorIdService } from "../services/analytics.visitor-id.service";

/**
 * UUID v1–v5 path segment. Same regex as the web helper
 * (`nextjs-jsonapi/src/features/analytics/lib/routeNormaliser.ts`).
 */
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Worker-side of `AnalyticsService.track()`.
 *
 * The queue name must be a compile-time constant because `@Processor()` is
 * evaluated at class-decoration time — the same constraint every other package
 * processor lives with (CompanyProcessor, HowToProcessor, ChunkProcessor). The
 * job name, by contrast, is read from `ANALYTICS_CONFIG` at construction
 * time, so producer and consumer always agree on it.
 *
 * Concurrency 1 so two events from one visitor can never both create a session.
 */
@Processor(QueueId.ANALYTICS, { concurrency: 1 })
export class AnalyticsProcessor extends WorkerHost {
  private readonly jobName: string;
  private readonly purgeJobName: string;
  private readonly sessionTimeoutMinutes: number;

  constructor(
    private readonly logger: AppLoggingService,
    private readonly repository: AnalyticsSessionRepository,
    private readonly visitorIds: AnalyticsVisitorIdService,
    private readonly cls: ClsService,
    @Inject(ANALYTICS_CONFIG) config: Required<AnalyticsModuleConfig>,
  ) {
    super();
    this.jobName = config.jobName;
    this.purgeJobName = `${config.jobName}${ANALYTICS_PURGE_JOB_SUFFIX}`;
    this.sessionTimeoutMinutes = config.sessionTimeoutMinutes;
  }

  @OnWorkerEvent("failed")
  onError(job: Job) {
    this.logger.error(`Analytics pageView failed (jobId=${job.id}): ${job.failedReason ?? "unknown"}`);
  }

  async process(job: Job<AnalyticsPageViewInput | AnalyticsPurgeVisitorInput>): Promise<void> {
    if (job.name === this.purgeJobName) {
      await this.purgeVisitor(job.data as AnalyticsPurgeVisitorInput);
      return;
    }

    if (job.name !== this.jobName) {
      throw new Error(`Job ${job.name} not handled by AnalyticsProcessor`);
    }

    const input = job.data as AnalyticsPageViewInput;

    if (this.visitorIds.isBot(input.userAgent)) {
      this.logger.debug(`analytics pageView dropped reason=bot path=${input.path}`);
      return;
    }

    // The worker runs outside any HTTP request, so CLS is empty: seed it
    // explicitly or SecurityService has no context to work from.
    await this.cls.run(async () => {
      this.cls.set("isAutomatedJob", true);

      const { visitorId, consented } = await this.visitorIds.resolve({
        visitorId: input.visitorId,
        clientIp: input.clientIp,
        userAgent: input.userAgent,
        receivedAt: input.receivedAt,
      });

      // On the Accept event the visitor may already have an open session under
      // their cookieless id: hand that id over so the repository can adopt it.
      const adoptVisitorId =
        input.consentGranted === true && input.visitorId
          ? await this.visitorIds.dailyVisitorId({
              clientIp: input.clientIp,
              userAgent: input.userAgent,
              receivedAt: input.receivedAt,
            })
          : null;

      const resolved: AnalyticsResolvedPageView = {
        visitorId,
        consented,
        path: input.path,
        route: this.normaliseRoute(input.path),
        section: input.section,
        referrerHost: this.referrerHost(input.referrer),
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        utmTerm: input.utmTerm ?? null,
        utmContent: input.utmContent ?? null,
        deviceType: this.visitorIds.deviceType(input.userAgent),
        userId: input.userId ?? null,
        receivedAt: input.receivedAt,
        sessionTimeoutMinutes: this.sessionTimeoutMinutes,
        adoptVisitorId,
      };

      const { sessionId, created } = await this.repository.recordPageView(resolved);

      this.logger.debug(`analytics pageView visitor=${visitorId} session=${sessionId} created=${created}`);
    });
  }

  /**
   * A caller with an excluded role has logged in: delete the anonymous
   * sessions recorded under this visitor's ids before the login. The cookie id
   * covers every session from this browser; the daily id changes each day, so
   * it only reaches today's.
   */
  private async purgeVisitor(input: AnalyticsPurgeVisitorInput): Promise<void> {
    await this.cls.run(async () => {
      this.cls.set("isAutomatedJob", true);

      const dailyVisitorId = await this.visitorIds.dailyVisitorId({
        clientIp: input.clientIp,
        userAgent: input.userAgent,
        receivedAt: input.receivedAt,
      });
      const visitorIds = [dailyVisitorId];
      if (input.visitorId) visitorIds.push((await this.visitorIds.resolve(input)).visitorId);

      const { sessions, pageViews } = await this.repository.deleteAnonymousSessions({ visitorIds });

      if (sessions > 0) {
        this.logger.debug(`analytics visitor purged sessions=${sessions} pageViews=${pageViews}`);
      }
    });
  }

  private normaliseRoute(path: string): string {
    return path
      .split("/")
      .map((segment) => (UUID_SEGMENT.test(segment) ? ":id" : segment))
      .join("/");
  }

  private referrerHost(referrer?: string): string | null {
    if (!referrer) return null;
    try {
      return new URL(referrer).hostname || null;
    } catch {
      return null;
    }
  }
}
