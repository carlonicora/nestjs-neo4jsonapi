import { BullModule } from "@nestjs/bullmq";
import { DynamicModule, Module, Provider } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { QueueId } from "../../config/enums/queue.id";
import { EmailModule } from "../../core/email/email.module";
import { CompanyModule } from "../company/company.module";
import { StripePriceModule } from "../stripe-price/stripe-price.module";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { StripeWebhookModule } from "../stripe-webhook/stripe-webhook.module";
import { CreditWarningController } from "./controllers/credit-warning.controller";
import { BillingLifecycleCron } from "./cron/billing-lifecycle.cron";
import { BILLING_CONFIG, BillingModuleConfig, resolveBillingConfig } from "./interfaces/billing.config.interface";
import { BillingEmailProcessor } from "./processors/billing-email.processor";
import { CardExpiryWarningService } from "./services/card-expiry-warning.service";
import { CreditWarningService } from "./services/credit-warning.service";

/**
 * BillingModule — per-app billing settings and billing housekeeping.
 *
 * - `BILLING_CONFIG` (global): the resolved settings every billing service reads
 * - `BillingLifecycleCron` (worker only): hourly card-expiry check
 * - `BillingEmailProcessor` (worker only, opt-in): the library billing email sender on `QueueId.EMAIL`
 * - `CreditWarningService` + `CreditWarningController`: the credit warning (always
 *   provided; every method is a no-op unless `billing.creditWarning.enabled`)
 *
 * Always mounted by `FoundationsModule`.
 *
 * @example
 * ```typescript
 * // Through bootstrap, which forwards it to FoundationsModule
 * bootstrap({ billing: { emailSender: { enabled: true } } })
 * ```
 */
@Module({})
export class BillingModule {
  /**
   * Configure the BillingModule.
   *
   * @param config - Optional configuration merged key by key over DEFAULT_BILLING_CONFIG
   */
  static forRoot(config?: BillingModuleConfig): DynamicModule {
    const resolved = resolveBillingConfig(config);

    const configProvider: Provider = {
      provide: BILLING_CONFIG,
      useValue: resolved,
    };

    return {
      module: BillingModule,
      global: true,
      imports: [
        BullModule.registerQueue({ name: QueueId.EMAIL }),
        EmailModule,
        CompanyModule,
        StripePriceModule,
        StripeSubscriptionModule,
        StripeCustomerModule,
        StripeWebhookModule,
      ],
      controllers: [CreditWarningController],
      providers: [
        configProvider,
        CardExpiryWarningService,
        CreditWarningService,
        createWorkerProvider(BillingLifecycleCron),
        ...(resolved.emailSender.enabled ? [createWorkerProvider(BillingEmailProcessor)] : []),
      ],
      exports: [BILLING_CONFIG],
    };
  }
}
