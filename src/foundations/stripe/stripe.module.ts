import { Module, OnModuleInit } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { createWorkerProvider, modelRegistry } from "@carlonicora/nestjs-neo4jsonapi";
import { BillingAdminController } from "./controllers/billing-admin.controller";
import { BillingController } from "./controllers/billing.controller";
import { WebhookController } from "./controllers/webhook.controller";
import { BillingCustomerModel } from "./entities/billing-customer.model";
import { InvoiceModel } from "./entities/invoice.model";
import { StripePriceModel } from "./entities/stripe-price.model";
import { StripeProductModel } from "./entities/stripe-product.model";
import { SubscriptionModel } from "./entities/subscription.model";
import { UsageRecordModel } from "./entities/usage-record.model";
import { WebhookEventModel } from "./entities/webhook-event.model";
import { WebhookProcessor } from "./processors/webhook.processor";
import { BillingCustomerRepository } from "./repositories/billing-customer.repository";
import { InvoiceRepository } from "./repositories/invoice.repository";
import { StripePriceRepository } from "./repositories/stripe-price.repository";
import { StripeProductRepository } from "./repositories/stripe-product.repository";
import { SubscriptionRepository } from "./repositories/subscription.repository";
import { UsageRecordRepository } from "./repositories/usage-record.repository";
import { WebhookEventRepository } from "./repositories/webhook-event.repository";
import { BillingCustomerSerialiser } from "./serialisers/billing-customer.serialiser";
import { InvoiceSerialiser } from "./serialisers/invoice.serialiser";
import { StripePriceSerialiser } from "./serialisers/stripe-price.serialiser";
import { StripeProductSerialiser } from "./serialisers/stripe-product.serialiser";
import { SubscriptionSerialiser } from "./serialisers/subscription.serialiser";
import { UsageRecordSerialiser } from "./serialisers/usage-record.serialiser";
import { WebhookEventSerialiser } from "./serialisers/webhook-event.serialiser";
import { BillingAdminService } from "./services/billing-admin.service";
import { BillingService } from "./services/billing.service";
import { InvoiceService } from "./services/invoice.service";
import { SubscriptionService } from "./services/subscription.service";
import { UsageService } from "./services/usage.service";
import { StripeService } from "./services/stripe.service";
import { StripeCustomerService } from "./services/stripe.customer.service";
import { StripeInvoiceService } from "./services/stripe.invoice.service";
import { StripePaymentService } from "./services/stripe.payment.service";
import { StripePortalService } from "./services/stripe.portal.service";
import { StripeProductService } from "./services/stripe.product.service";
import { StripeSubscriptionService } from "./services/stripe.subscription.service";
import { StripeUsageService } from "./services/stripe.usage.service";
import { StripeWebhookService } from "./services/stripe.webhook.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: `${process.env.QUEUE}_billing_webhook`,
    }),
  ],
  controllers: [BillingController, BillingAdminController, WebhookController],
  providers: [
    // Stripe API Services
    StripeService,
    StripeCustomerService,
    StripeInvoiceService,
    StripePaymentService,
    StripePortalService,
    StripeProductService,
    StripeSubscriptionService,
    StripeUsageService,
    StripeWebhookService,
    // Business Logic Services
    BillingService,
    BillingAdminService,
    SubscriptionService,
    InvoiceService,
    UsageService,
    // Repositories
    BillingCustomerRepository,
    StripeProductRepository,
    StripePriceRepository,
    SubscriptionRepository,
    InvoiceRepository,
    UsageRecordRepository,
    WebhookEventRepository,
    // Serializers
    BillingCustomerSerialiser,
    StripeProductSerialiser,
    StripePriceSerialiser,
    SubscriptionSerialiser,
    InvoiceSerialiser,
    UsageRecordSerialiser,
    WebhookEventSerialiser,
    // Processor only runs in Worker mode via createWorkerProvider
    createWorkerProvider(WebhookProcessor),
  ],
  exports: [
    // Stripe API Services
    StripeService,
    StripeCustomerService,
    StripeInvoiceService,
    StripePaymentService,
    StripePortalService,
    StripeProductService,
    StripeSubscriptionService,
    StripeUsageService,
    StripeWebhookService,
    // Business Logic Services
    BillingService,
    BillingAdminService,
    SubscriptionService,
    InvoiceService,
    UsageService,
    // Repositories
    BillingCustomerRepository,
    StripeProductRepository,
    StripePriceRepository,
    SubscriptionRepository,
    InvoiceRepository,
    UsageRecordRepository,
    WebhookEventRepository,
  ],
})
export class StripeModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(BillingCustomerModel);
    modelRegistry.register(StripeProductModel);
    modelRegistry.register(StripePriceModel);
    modelRegistry.register(SubscriptionModel);
    modelRegistry.register(InvoiceModel);
    modelRegistry.register(UsageRecordModel);
    modelRegistry.register(WebhookEventModel);
  }
}
