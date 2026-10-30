import { BullModule } from "@nestjs/bullmq";
import { DynamicModule, Global, Module, OnModuleInit, Provider } from "@nestjs/common";

import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { CompanyModule } from "../company/company.module";
import { UserModule } from "../user/user.module";
import { REGISTRATION_HOOK } from "../auth/interfaces/registration-hook.interface";
import { REFERRAL_COMPLETION_HANDLER } from "../stripe-webhook/interfaces/referral-completion-handler.interface";

import { ReferralAdminController } from "./controllers/referral.admin.controller";
import { ReferralController } from "./controllers/referral.controller";
import { ReferralPublicController } from "./controllers/referral.public.controller";
import { ReferralAdminReferralDescriptor } from "./entities/referral-admin-referral";
import { ReferralAdminReferrerDescriptor } from "./entities/referral-admin-referrer";
import { ReferralAdminSummaryDescriptor } from "./entities/referral-admin-summary";
import { ReferralCodeDescriptor } from "./entities/referral-code";
import { ReferralStatsDescriptor } from "./entities/referral-stats";
import { ReferralDescriptor } from "./entities/referral";
import { ReferralInviteDescriptor } from "./entities/referral-invite";
import { ReferralVisitDescriptor } from "./entities/referral-visit";
import { ReferralAdminRepository } from "./repositories/referral.admin.repository";
import { ReferralRepository } from "./repositories/referral.repository";
import { ReferralAdminService } from "./services/referral.admin.service";
import { ReferralService } from "./services/referral.service";
import { RegistrationReferralHook } from "./services/registration-referral.hook";
import {
  DEFAULT_REFERRAL_CONFIG,
  REFERRAL_CONFIG,
  ReferralModuleAsyncOptions,
  ReferralModuleConfig,
} from "./interfaces/referral.config.interface";

/**
 * ReferralModule
 *
 * Provides referral functionality with configurable token rewards.
 * Uses forRoot/forRootAsync patterns for flexible configuration.
 *
 * Features:
 * - Referral code generation and tracking
 * - Referral invite emails with cooldown
 * - Token rewards on referral completion
 * - Integration with AuthService via REGISTRATION_HOOK
 * - Integration with StripeWebhook via REFERRAL_COMPLETION_HANDLER
 *
 * Usage:
 * ```typescript
 * // Synchronous configuration
 * ReferralModule.forRoot({
 *   enabled: true,
 *   rewardTokens: 1000,
 * })
 *
 * // Async configuration with ConfigService
 * ReferralModule.forRootAsync({
 *   imports: [ConfigModule],
 *   useFactory: (configService: ConfigService) => ({
 *     enabled: configService.get('REFERRAL_ENABLED') === 'true',
 *     rewardTokens: configService.get('REFERRAL_REWARD_TOKENS') || 1000,
 *   }),
 *   inject: [ConfigService],
 * })
 * ```
 *
 * Note: Referral URLs use process.env.APP_URL automatically.
 */
@Global()
@Module({})
export class ReferralModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(ReferralDescriptor.model);
    modelRegistry.register(ReferralCodeDescriptor.model);
    modelRegistry.register(ReferralStatsDescriptor.model);
    modelRegistry.register(ReferralInviteDescriptor.model);
    modelRegistry.register(ReferralVisitDescriptor.model);
    modelRegistry.register(ReferralAdminSummaryDescriptor.model);
    modelRegistry.register(ReferralAdminReferrerDescriptor.model);
    modelRegistry.register(ReferralAdminReferralDescriptor.model);
  }

  /**
   * Configure the ReferralModule with synchronous options.
   * @param config - Optional configuration that will be merged with defaults
   */
  static forRoot(config?: ReferralModuleConfig): DynamicModule {
    const mergedConfig = { ...DEFAULT_REFERRAL_CONFIG, ...config };

    const configProvider: Provider = {
      provide: REFERRAL_CONFIG,
      useValue: mergedConfig,
    };

    return this.createModule([configProvider]);
  }

  /**
   * Configure the ReferralModule with async options.
   * Use this when configuration depends on other services like ConfigService.
   * @param options - Async options with useFactory function
   */
  static forRootAsync(options: ReferralModuleAsyncOptions): DynamicModule {
    const configProvider: Provider = {
      provide: REFERRAL_CONFIG,
      useFactory: async (...args: unknown[]) => {
        const config = await options.useFactory(...args);
        return { ...DEFAULT_REFERRAL_CONFIG, ...config };
      },
      inject: options.inject || [],
    };

    return this.createModule([configProvider], options.imports);
  }

  /**
   * Create the dynamic module with all providers and exports.
   * @param providers - Configuration providers (sync or async)
   * @param imports - Additional imports for async configuration
   */
  private static createModule(providers: Provider[], imports: unknown[] = []): DynamicModule {
    const registrationHookProvider: Provider = {
      provide: REGISTRATION_HOOK,
      useClass: RegistrationReferralHook,
    };

    const referralCompletionProvider: Provider = {
      provide: REFERRAL_COMPLETION_HANDLER,
      useExisting: ReferralService,
    };

    return {
      module: ReferralModule,
      imports: [CompanyModule, UserModule, BullModule.registerQueue({ name: QueueId.EMAIL }), ...(imports as any[])],
      controllers: [ReferralController, ReferralPublicController, ReferralAdminController],
      providers: [
        ...providers,
        ReferralCodeDescriptor.model.serialiser,
        ReferralStatsDescriptor.model.serialiser,
        ReferralDescriptor.model.serialiser,
        ReferralAdminSummaryDescriptor.model.serialiser,
        ReferralAdminReferrerDescriptor.model.serialiser,
        ReferralAdminReferralDescriptor.model.serialiser,
        ReferralRepository,
        ReferralService,
        ReferralAdminRepository,
        ReferralAdminService,
        RegistrationReferralHook,
        registrationHookProvider,
        referralCompletionProvider,
      ],
      exports: [
        ReferralService,
        ReferralRepository,
        registrationHookProvider,
        referralCompletionProvider,
        REFERRAL_CONFIG,
      ],
    };
  }
}
