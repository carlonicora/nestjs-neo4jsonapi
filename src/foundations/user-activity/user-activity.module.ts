import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { DynamicModule, Module, OnModuleInit, Provider } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { UserActivityDescriptor } from "./entities/user-activity";
import { UserActivityInterceptor } from "./interceptors/user-activity.interceptor";
import {
  DEFAULT_USER_ACTIVITY_CONFIG,
  USER_ACTIVITY_CONFIG,
  USER_ACTIVITY_QUEUE,
  UserActivityModuleConfig,
} from "./interfaces/user-activity.config.interface";
import { UserActivityProcessor } from "./processors/user-activity.processor";
import { UserActivityRepository } from "./repositories/user-activity.repository";
import { UserActivityService } from "./services/user-activity.service";

/**
 * UserActivityModule — append-only audit trail of user actions.
 *
 * Writes `(User)-[:PERFORMED]->(UserActivity)-[:BELONGS_TO]->(Company)` through a
 * BullMQ worker, so recording never blocks (or breaks) the caller's request path.
 * The module exposes NO HTTP routes: activities are produced by explicit
 * `UserActivityService.record()` calls and — optionally — by a global interceptor.
 *
 * Defaults are deliberately inert: with `forRoot()` and no config, no
 * APP_INTERCEPTOR is registered and nothing is recorded unless the app calls
 * `record()` itself.
 *
 * The descriptor is NOT registered with the GraphDescriptorRegistry here —
 * graph-catalog registration is an application-level policy decision.
 *
 * @example
 * ```typescript
 * // Inert (library default): producer available, no global interceptor
 * UserActivityModule.forRoot()
 *
 * // Fully enabled, with app-owned queue/job identifiers
 * UserActivityModule.forRoot({
 *   queueId: QueueId.USER_ACTIVITY,
 *   jobName: JobName.userActivity.Record,
 *   interceptorEnabled: true,
 * })
 * ```
 */
@Module({})
export class UserActivityModule implements OnModuleInit {
  /**
   * Configure the UserActivityModule.
   *
   * @param config - Optional configuration merged over DEFAULT_USER_ACTIVITY_CONFIG
   */
  static forRoot(config?: UserActivityModuleConfig): DynamicModule {
    const mergedConfig: Required<UserActivityModuleConfig> = { ...DEFAULT_USER_ACTIVITY_CONFIG, ...config };

    const providers: Provider[] = [
      { provide: USER_ACTIVITY_CONFIG, useValue: mergedConfig },
      // `@InjectQueue()` needs a compile-time name; the configured queue token
      // is aliased onto a stable token the service can inject instead.
      { provide: USER_ACTIVITY_QUEUE, useExisting: getQueueToken(mergedConfig.queueId) },
      UserActivityDescriptor.model.serialiser,
      UserActivityRepository,
      UserActivityService,
      createWorkerProvider(UserActivityProcessor),
    ];

    // Global HTTP interceptor is opt-in ONLY: without `interceptorEnabled` the
    // APP_INTERCEPTOR provider is never added, so consuming apps that do not ask
    // for it see no behaviour change at all.
    if (mergedConfig.interceptorEnabled) {
      providers.push({
        provide: APP_INTERCEPTOR,
        useClass: UserActivityInterceptor,
      });
    }

    return {
      module: UserActivityModule,
      // Global so `UserActivityService` reaches feature modules without each of
      // them importing (and thereby re-instantiating) this dynamic module: a
      // bare `UserActivityModule` import resolves to the empty `@Module({})`
      // shell, and re-calling `forRoot()` per consumer would register a second
      // worker provider and a duplicate APP_INTERCEPTOR. Mirrors the
      // `ContentModule.forRoot` precedent (content.module.ts:69).
      global: true,
      imports: [BullModule.registerQueue({ name: mergedConfig.queueId })],
      providers,
      exports: [UserActivityService, UserActivityRepository, USER_ACTIVITY_CONFIG],
    };
  }

  onModuleInit() {
    modelRegistry.register(UserActivityDescriptor.model);
  }
}
