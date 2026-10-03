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
  }

  /**
   * Enqueue a page view for async write. Never throws — analytics must not
   * break the caller's request path.
   */
  async track(input: AnalyticsPageViewInput): Promise<void> {
    try {
      await this.queue.add(this.jobName, input);
    } catch (err) {
      this.logger.error(`AnalyticsService.track enqueue failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
