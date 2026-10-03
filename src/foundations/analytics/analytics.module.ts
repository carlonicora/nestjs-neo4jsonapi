import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { DynamicModule, Module, OnModuleInit, Provider } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { baseConfig } from "../../config/base.config";
import { AuditModule } from "../audit/audit.module";
import { AnalyticsAdminController } from "./controllers/analytics.admin.controller";
import { AnalyticsController } from "./controllers/analytics.controller";
import { AnalyticsRetentionCron } from "./cron/analytics-retention.cron";
import { AnalyticsBreakdownDescriptor } from "./entities/analytics-breakdown";
import { AnalyticsDailySummaryDescriptor } from "./entities/analytics-daily-summary";
import { AnalyticsPageViewDescriptor } from "./entities/analytics-page-view";
import { AnalyticsSessionDescriptor } from "./entities/analytics-session";
import { AnalyticsSummaryDescriptor } from "./entities/analytics-summary";
import { AnalyticsTimelineDescriptor } from "./entities/analytics-timeline";
import {
  ANALYTICS_CONFIG,
  ANALYTICS_QUEUE,
  AnalyticsModuleConfig,
  DEFAULT_ANALYTICS_CONFIG,
} from "./interfaces/analytics.config.interface";
import { AnalyticsProcessor } from "./processors/analytics.processor";
import { AnalyticsDailySummaryRepository } from "./repositories/analytics-daily-summary.repository";
import { AnalyticsPageViewRepository } from "./repositories/analytics-page-view.repository";
import { AnalyticsSessionRepository } from "./repositories/analytics-session.repository";
import { AnalyticsAdminRepository } from "./repositories/analytics.admin.repository";
import { AnalyticsAdminService } from "./services/analytics.admin.service";
import { AnalyticsService } from "./services/analytics.service";
import { AnalyticsVisitorIdService } from "./services/analytics.visitor-id.service";

/**
 * AnalyticsModule — first-party, GDPR-compliant web analytics.
 *
 * A public, throttled endpoint enqueues one job per page view; a BullMQ worker
 * resolves the visitor, the 30-minute session and the user link, and writes the
 * platform-level `AnalyticsSession` / `AnalyticsPageView` nodes. Administrator
 * endpoints aggregate raw events plus daily summaries, and a nightly cron rolls
 * up and deletes events older than the retention window.
 *
 * Switched on by environment: `ANALYTICS_ENABLED=true` (plus the optional
 * `ANALYTICS_RETENTION_MONTHS` / `ANALYTICS_SESSION_TIMEOUT_MINUTES`), read
 * through `baseConfig.analytics`. With the variable unset and no explicit
 * config the module registers nothing — no controller, no queue, no processor,
 * no cron.
 *
 * @example
 * ```typescript
 * // Driven by ANALYTICS_ENABLED (the normal way)
 * AnalyticsModule.forRoot()
 *
 * // Explicit override, wins over the environment
 * AnalyticsModule.forRoot({ enabled: false })
 * ```
 */
@Module({})
export class AnalyticsModule implements OnModuleInit {
  /**
   * Configure the AnalyticsModule.
   *
   * Merge order: DEFAULT_ANALYTICS_CONFIG, then the environment block
   * (`baseConfig.analytics`), then the explicit `config` argument.
   *
   * @param config - Optional override; wins over the environment variables
   */
  static forRoot(config?: AnalyticsModuleConfig): DynamicModule {
    const mergedConfig: Required<AnalyticsModuleConfig> = {
      ...DEFAULT_ANALYTICS_CONFIG,
      ...baseConfig.analytics,
      ...config,
    };

    if (!mergedConfig.enabled) return { module: AnalyticsModule, providers: [], controllers: [], imports: [] };

    const providers: Provider[] = [
      { provide: ANALYTICS_CONFIG, useValue: mergedConfig },
      // `@InjectQueue()` needs a compile-time name; the configured queue token
      // is aliased onto a stable token the service can inject instead.
      { provide: ANALYTICS_QUEUE, useExisting: getQueueToken(mergedConfig.queueId) },
      AnalyticsSessionDescriptor.model.serialiser,
      AnalyticsPageViewDescriptor.model.serialiser,
      AnalyticsDailySummaryDescriptor.model.serialiser,
      AnalyticsSummaryDescriptor.model.serialiser,
      AnalyticsTimelineDescriptor.model.serialiser,
      AnalyticsBreakdownDescriptor.model.serialiser,
      AnalyticsSessionRepository,
      AnalyticsPageViewRepository,
      AnalyticsDailySummaryRepository,
      AnalyticsAdminRepository,
      AnalyticsVisitorIdService,
      AnalyticsService,
      AnalyticsAdminService,
      createWorkerProvider(AnalyticsProcessor),
      createWorkerProvider(AnalyticsRetentionCron),
    ];

    return {
      module: AnalyticsModule,
      // Global so `AnalyticsService` reaches feature modules without each of
      // them importing (and thereby re-instantiating) this dynamic module.
      // Mirrors `UserActivityModule.forRoot`.
      global: true,
      imports: [BullModule.registerQueue({ name: mergedConfig.queueId }), AuditModule],
      controllers: [AnalyticsController, AnalyticsAdminController],
      providers,
      exports: [AnalyticsService, AnalyticsAdminService, ANALYTICS_CONFIG],
    };
  }

  onModuleInit() {
    modelRegistry.register(AnalyticsSessionDescriptor.model);
    modelRegistry.register(AnalyticsPageViewDescriptor.model);
    modelRegistry.register(AnalyticsDailySummaryDescriptor.model);
    modelRegistry.register(AnalyticsSummaryDescriptor.model);
    modelRegistry.register(AnalyticsTimelineDescriptor.model);
    modelRegistry.register(AnalyticsBreakdownDescriptor.model);
  }
}
