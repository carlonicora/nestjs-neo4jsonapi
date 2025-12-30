import { BullModule } from "@nestjs/bullmq";
import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { StripeInvoiceModule } from "../stripe-invoice/stripe-invoice.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { BillingController } from "./controllers/billing.controller";
import { WebhookController } from "./controllers/webhook.controller";
import { BillingCustomerModel } from "./entities/billing-customer.model";
import { UsageRecordModel } from "./entities/usage-record.model";
import { WebhookEventModel } from "./entities/webhook-event.model";
import { WebhookProcessor } from "./processors/webhook.processor";
import { BillingCustomerRepository } from "./repositories/billing-customer.repository";
import { UsageRecordRepository } from "./repositories/usage-record.repository";
import { WebhookEventRepository } from "./repositories/webhook-event.repository";
import { BillingCustomerSerialiser } from "./serialisers/billing-customer.serialiser";
import { UsageRecordSerialiser } from "./serialisers/usage-record.serialiser";
import { WebhookEventSerialiser } from "./serialisers/webhook-event.serialiser";
import { BillingService } from "./services/billing.service";
import { NotificationService } from "./services/notification.service";
import { StripeCustomerService } from "./services/stripe.customer.service";
import { StripePaymentService } from "./services/stripe.payment.service";
import { StripePortalService } from "./services/stripe.portal.service";
import { StripeService } from "./services/stripe.service";
import { StripeUsageService } from "./services/stripe.usage.service";
import { StripeWebhookService } from "./services/stripe.webhook.service";
import { UsageService } from "./services/usage.service";

@Module({
  imports: [
    forwardRef(() => StripeInvoiceModule),
    forwardRef(() => StripeSubscriptionModule),
    BullModule.registerQueue({ name: QueueId.BILLING_WEBHOOK }),
    BullModule.registerQueue({ name: QueueId.EMAIL }),
  ],
  controllers: [BillingController, WebhookController],
  providers: [
    // Stripe API Services
    StripeService,
    StripeCustomerService,
    StripePaymentService,
    StripePortalService,
    StripeUsageService,
    StripeWebhookService,
    // Business Logic Services
    BillingService,
    UsageService,
    NotificationService,
    // Repositories
    BillingCustomerRepository,
    UsageRecordRepository,
    WebhookEventRepository,
    // Serializers
    BillingCustomerSerialiser,
    UsageRecordSerialiser,
    WebhookEventSerialiser,
    // Processor only runs in Worker mode via createWorkerProvider
    createWorkerProvider(WebhookProcessor),
  ],
  exports: [
    // Stripe API Services
    StripeService,
    StripeCustomerService,
    StripePaymentService,
    StripePortalService,
    StripeUsageService,
    StripeWebhookService,
    // Business Logic Services
    BillingService,
    UsageService,
    NotificationService,
    // Repositories
    BillingCustomerRepository,
    UsageRecordRepository,
    WebhookEventRepository,
  ],
})
export class StripeModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(BillingCustomerModel);
    modelRegistry.register(UsageRecordModel);
    modelRegistry.register(WebhookEventModel);
  }
}
