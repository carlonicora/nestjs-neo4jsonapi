import { QueueId } from "../../../config/enums/queue.id";

/**
 * Configuration interface for the UserActivityModule.
 *
 * Every option is optional and defaults to the inert/library-safe value, so
 * `UserActivityModule.forRoot()` with no arguments changes nothing about a
 * consuming app's HTTP surface: no global interceptor is registered and no
 * activity is recorded unless the app calls `UserActivityService.record()`
 * itself.
 */
export interface UserActivityModuleConfig {
  /**
   * BullMQ queue the producer (`UserActivityService.record()`) enqueues onto.
   *
   * The module registers this queue itself (`BullModule.registerQueue`), so an
   * app does not have to add it to its own queue configuration.
   *
   * NOTE: the worker side (`UserActivityProcessor`) binds to `QueueId.USER_ACTIVITY`
   * through the `@Processor()` decorator, which BullMQ evaluates at class-decoration
   * time and therefore cannot read from this config. Overriding `queueId` with a
   * different value moves the producer only — the consuming app must then run its
   * own worker for that queue. Every package processor has the same constraint
   * (see `CompanyProcessor`, `HowToProcessor`, `ChunkProcessor`).
   *
   * @default QueueId.USER_ACTIVITY ("user-activity")
   */
  queueId?: string;

  /**
   * BullMQ job name used for the enqueue/dispatch handshake between
   * `UserActivityService.record()` and `UserActivityProcessor.process()`.
   *
   * Both sides read this same value, so an app may rename it freely (e.g. to
   * match its own `JobName` enum) as long as it is configured once here.
   *
   * @default "userActivity:record"
   */
  jobName?: string;

  /**
   * When true, the module registers a global `APP_INTERCEPTOR`
   * (`UserActivityInterceptor`) that records a coarse-grained
   * `ENTITY`/`CREATE|UPDATE|DELETE` activity for every authenticated
   * non-GET, non-OPTIONS request outside the health/metrics/auth paths.
   *
   * Default false: the interceptor is a cross-cutting, app-visible behaviour
   * change and must be opted into explicitly.
   *
   * @default false
   */
  interceptorEnabled?: boolean;
}

/**
 * Injection token for the resolved user-activity configuration.
 * Always resolves to a `Required<UserActivityModuleConfig>` (defaults merged in).
 */
export const USER_ACTIVITY_CONFIG = Symbol("USER_ACTIVITY_CONFIG");

/**
 * Injection token for the BullMQ queue the module was configured with.
 *
 * `@InjectQueue()` cannot be used directly because the queue name is only known
 * at `forRoot()` time; the module aliases the configured BullMQ queue token onto
 * this stable token instead.
 */
export const USER_ACTIVITY_QUEUE = Symbol("USER_ACTIVITY_QUEUE");

/**
 * Default configuration values.
 */
export const DEFAULT_USER_ACTIVITY_CONFIG: Required<UserActivityModuleConfig> = {
  queueId: QueueId.USER_ACTIVITY,
  jobName: "userActivity:record",
  interceptorEnabled: false,
};
