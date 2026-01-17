import { BullModule } from "@nestjs/bullmq";
import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripeInvoiceModule } from "../stripe-invoice/stripe-invoice.module";
import { StripePriceModule } from "../stripe-price/stripe-price.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { StripeModule } from "../stripe/stripe.module";
import { CompanyModule } from "../company/company.module";
import { UserModule } from "../user/user.module";
import { StripeWebhookController } from "./controllers/stripe-webhook.controller";
import { StripeWebhookEventModel } from "./entities/stripe-webhook-event.model";
import { StripeWebhookProcessor } from "./processors/stripe-webhook.processor";
import { StripeWebhookEventRepository } from "./repositories/stripe-webhook-event.repository";
import { StripeWebhookEventSerialiser } from "./serialisers/stripe-webhook-event.serialiser";
import { StripeWebhookNotificationService } from "./services/stripe-webhook-notification.service";
import { StripeWebhookService } from "./services/stripe-webhook.service";

/**
 * StripeWebhookModule
 *
 * Handles Stripe webhook event reception, validation, persistence, and processing.
 * Uses BullMQ for asynchronous, reliable webhook processing with automatic retries.
 *
 * Key Features:
 * - Webhook signature verification via StripeWebhookService
 * - Idempotent event handling with StripeWebhookEvent persistence
 * - BullMQ-based async processing for non-blocking webhook responses
 * - Notification dispatch for payment failures and subscription changes
 * - Event routing to appropriate domain handlers (subscription, invoice, customer)
 *
 * Components:
 * - **Controller**: StripeWebhookController - receives and validates Stripe webhooks
 * - **Services**:
 *   - StripeWebhookService: Signature verification and event parsing
 *   - StripeWebhookNotificationService: Payment failure and subscription change notifications
 * - **Processor**: StripeWebhookProcessor (BullMQ worker) - async event processing
 * - **Repository**: StripeWebhookEventRepository - event persistence and status tracking
 *
 * Dependencies:
 * - StripeModule: For Stripe SDK client access
 * - StripeCustomerModule: For customer data in notifications
 * - StripeInvoiceModule: For invoice data in notifications
 * - StripeSubscriptionModule: For subscription sync operations
 *
 * All cross-module dependencies use forwardRef to handle circular imports.
 */
@Module({
  imports: [
    forwardRef(() => StripeModule),
    forwardRef(() => StripeCustomerModule),
    forwardRef(() => StripeInvoiceModule),
    forwardRef(() => StripePriceModule),
    forwardRef(() => StripeSubscriptionModule),
    forwardRef(() => CompanyModule),
    forwardRef(() => UserModule),
    BullModule.registerQueue({ name: QueueId.BILLING_WEBHOOK }),
    BullModule.registerQueue({ name: QueueId.EMAIL }),
  ],
  controllers: [StripeWebhookController],
  providers: [
    // Services
    StripeWebhookService,
    StripeWebhookNotificationService,
    // Repository
    StripeWebhookEventRepository,
    // Serializer
    StripeWebhookEventSerialiser,
    // Processor (worker mode only)
    createWorkerProvider(StripeWebhookProcessor),
  ],
  exports: [
    // Services
    StripeWebhookService,
    StripeWebhookNotificationService,
    // Repository
    StripeWebhookEventRepository,
  ],
})
export class StripeWebhookModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeWebhookEventModel);
  }
}
