import { BullModule } from "@nestjs/bullmq";
import { DynamicModule, Global, Module, OnModuleInit } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { AuditModule } from "../audit/audit.module";
import { S3Module } from "../s3/s3.module";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { ResponseLanguageModule } from "../user/response-language.module";
import {
  ACCOUNT_DELETION_CONFIG,
  AccountDeletionModuleConfig,
  DEFAULT_ACCOUNT_DELETION_CONFIG,
} from "./account-deletion.config";
import { AccountDeletionController } from "./controllers/account-deletion.controller";
import { AccountDeletionCron } from "./cron/account-deletion.cron";
import { AccountDeletionDescriptor } from "./entities/account-deletion";
import { ACCOUNT_DELETION_LOGIN_HOOK } from "./interfaces/account-deletion-login-hook.interface";
import { AccountDeletionProcessor } from "./processors/account-deletion.processor";
import { AccountDeletionRepository } from "./repositories/account-deletion.repository";
import { AccountDeletionWipeRepository } from "./repositories/account-deletion.wipe.repository";
import { AccountDeletionService } from "./services/account-deletion.service";
import { AccountWipeService } from "./services/account-wipe.service";
import { FullCompanyDeletionService } from "./services/full-company-deletion.service";

/**
 * AccountDeletionModule — self-service account deletion with a grace period.
 *
 * OPT-IN (OD-3): mounted only when the app passes `accountDeletion` to
 * `bootstrap()` / `FoundationsModule.forRoot()`. Absent, no route, cron, queue,
 * processor or login hook exists and login behaves exactly as before.
 *
 * Global so `AuthService` (AuthModule) can inject the optional
 * `ACCOUNT_DELETION_LOGIN_HOOK`, and an app can provide
 * `{ provide: COMPANY_DELETION_HANDLER, useExisting: FullCompanyDeletionService }`.
 * The app's own content plugs in through `ACCOUNT_DELETION_HANDLER`.
 *
 * `AccountDeletionDescriptor` is a synthetic resource with no Neo4j node: its
 * serialiser is listed here and its model registered in `onModuleInit` (OD-2).
 *
 * @example
 * ```typescript
 * FoundationsModule.forRoot({ accountDeletion: {} })            // 7-day grace
 * FoundationsModule.forRoot({ accountDeletion: { graceDays: 14 } })
 * ```
 */
@Global()
@Module({
  imports: [
    // defaultJobOptions are left to each job (ACCOUNT_DELETION_JOB_OPTIONS), set by whoever enqueues.
    BullModule.registerQueue({ name: QueueId.ACCOUNT_DELETION }),
    AuditModule,
    S3Module,
    StripeCustomerModule,
    StripeSubscriptionModule,
    ResponseLanguageModule,
  ],
  controllers: [AccountDeletionController],
  providers: [
    AccountDeletionDescriptor.model.serialiser,
    AccountDeletionRepository,
    AccountDeletionService,
    { provide: ACCOUNT_DELETION_LOGIN_HOOK, useExisting: AccountDeletionService },
    AccountDeletionWipeRepository,
    AccountWipeService,
    FullCompanyDeletionService,
    AccountDeletionCron,
    createWorkerProvider(AccountDeletionProcessor),
  ],
  exports: [ACCOUNT_DELETION_LOGIN_HOOK, AccountDeletionService, AccountDeletionRepository, FullCompanyDeletionService],
})
export class AccountDeletionModule implements OnModuleInit {
  /**
   * @param config - merged over DEFAULT_ACCOUNT_DELETION_CONFIG
   */
  static forRoot(config?: AccountDeletionModuleConfig): DynamicModule {
    const merged: Required<AccountDeletionModuleConfig> = { ...DEFAULT_ACCOUNT_DELETION_CONFIG, ...config };

    return {
      module: AccountDeletionModule,
      global: true,
      providers: [{ provide: ACCOUNT_DELETION_CONFIG, useValue: merged }],
      exports: [ACCOUNT_DELETION_CONFIG],
    };
  }

  onModuleInit() {
    modelRegistry.register(AccountDeletionDescriptor.model);
  }
}
