import { Inject, Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { AnalyticsSession, AnalyticsSessionDescriptor } from "../entities/analytics-session";
import { ANALYTICS_CONFIG, ANALYTICS_QUEUE, AnalyticsModuleConfig } from "../interfaces/analytics.config.interface";
import { AnalyticsPageViewInput } from "../interfaces/analytics.page-view.input";
import { AnalyticsSessionRepository } from "../repositories/analytics-session.repository";

@Injectable()
export class AnalyticsService extends AbstractService<
  AnalyticsSession,
  typeof AnalyticsSessionDescriptor.relationships
> {
  protected readonly descriptor = AnalyticsSessionDescriptor;
  private readonly jobName: string;
  private readonly excludedRoleIds: Set<string>;
  private readonly excludedUserIds: Set<string>;

  constructor(
    jsonApiService: JsonApiService,
    analyticsSessionRepository: AnalyticsSessionRepository,
    clsService: ClsService,
    @Inject(ANALYTICS_QUEUE) private readonly queue: Queue,
    private readonly logger: AppLoggingService,
    @Inject(ANALYTICS_CONFIG) config: Required<AnalyticsModuleConfig>,
  ) {
    super(jsonApiService, analyticsSessionRepository, clsService, AnalyticsSessionDescriptor.model);
    this.jobName = config.jobName;
    this.excludedRoleIds = new Set(config.excludedRoleIds);
    this.excludedUserIds = new Set(config.excludedUserIds);
  }

  /**
   * Enqueue a page view for async write. Never throws — analytics must not
   * break the caller's request path.
   *
   * A page view from an excluded user id, or from a caller holding any
   * excluded role, is dropped before the queue. The roles only decide the
   * drop; they are not added to the job.
   */
  async track(input: AnalyticsPageViewInput, options?: { roles?: string[] }): Promise<void> {
    if (this._isExcluded(input.userId, options?.roles)) {
      // Path only: raw IP and user agent must not reach the logs.
      this.logger.debug(`analytics pageView dropped reason=excluded path=${input.path}`);
      return;
    }

    try {
      await this.queue.add(this.jobName, input);
    } catch (err) {
      this.logger.error(`AnalyticsService.track enqueue failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private _isExcluded(userId: string | undefined, roles: string[] | undefined): boolean {
    if (userId && this.excludedUserIds.has(userId)) return true;
    return (roles ?? []).some((roleId) => this.excludedRoleIds.has(roleId));
  }
}
