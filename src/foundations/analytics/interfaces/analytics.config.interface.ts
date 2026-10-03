import { QueueId } from "../../../config/enums/queue.id";

/**
 * Configuration interface for the AnalyticsModule.
 *
 * The normal way to configure analytics is the environment: `ANALYTICS_ENABLED`,
 * `ANALYTICS_RETENTION_MONTHS` and `ANALYTICS_SESSION_TIMEOUT_MINUTES`, read
 * through `baseConfig.analytics`. Values passed here are an override and win
 * over the environment. With the variable unset and no override, nothing is
 * registered: no controller, no queue and no processor.
 */
export interface AnalyticsModuleConfig {
  /**
   * When true, the module registers the public event endpoint, the admin
   * endpoints, the queue, the processor and the retention cron.
   *
   * Normally set through `ANALYTICS_ENABLED=true`; a value here overrides the
   * environment. Default false: analytics collection is an app-visible
   * behaviour change and must be opted into explicitly.
   *
   * @default false (env: ANALYTICS_ENABLED)
   */
  enabled?: boolean;

  /**
   * How many months raw sessions and page views are kept before the retention
   * cron rolls them up into daily summaries and deletes them.
   *
   * @default 13 (env: ANALYTICS_RETENTION_MONTHS)
   */
  retentionMonths?: number;

  /**
   * Inactivity window after which the next event from the same visitor starts
   * a new session.
   *
   * @default 30 (env: ANALYTICS_SESSION_TIMEOUT_MINUTES)
   */
  sessionTimeoutMinutes?: number;

  /**
   * BullMQ queue the producer (`AnalyticsService.track()`) enqueues onto.
   *
   * The module registers this queue itself (`BullModule.registerQueue`), so an
   * app does not have to add it to its own queue configuration.
   *
   * NOTE: the worker side (`AnalyticsProcessor`) binds to `QueueId.ANALYTICS`
   * through the `@Processor()` decorator, which BullMQ evaluates at class-decoration
   * time and therefore cannot read from this config. Overriding `queueId` with a
   * different value moves the producer only — the consuming app must then run its
   * own worker for that queue. Every package processor has the same constraint
   * (see `CompanyProcessor`, `HowToProcessor`, `ChunkProcessor`).
   *
   * @default QueueId.ANALYTICS ("analytics")
   */
  queueId?: string;

  /**
   * BullMQ job name used for the enqueue/dispatch handshake between
   * `AnalyticsService.track()` and `AnalyticsProcessor.process()`.
   *
   * Both sides read this same value, so an app may rename it freely (e.g. to
   * match its own `JobName` enum) as long as it is configured once here.
   *
   * @default "analytics:pageView"
   */
  jobName?: string;
}

/**
 * Injection token for the resolved analytics configuration.
 * Always resolves to a `Required<AnalyticsModuleConfig>` (defaults merged in).
 */
export const ANALYTICS_CONFIG = Symbol("ANALYTICS_CONFIG");

/**
 * Injection token for the BullMQ queue the module was configured with.
 *
 * `@InjectQueue()` cannot be used directly because the queue name is only known
 * at `forRoot()` time; the module aliases the configured BullMQ queue token onto
 * this stable token instead.
 */
export const ANALYTICS_QUEUE = Symbol("ANALYTICS_QUEUE");

/**
 * Default configuration values.
 */
export const DEFAULT_ANALYTICS_CONFIG: Required<AnalyticsModuleConfig> = {
  enabled: false,
  retentionMonths: 13,
  sessionTimeoutMinutes: 30,
  queueId: QueueId.ANALYTICS,
  jobName: "analytics:pageView",
};
