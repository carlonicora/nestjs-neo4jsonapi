import { Module, forwardRef } from "@nestjs/common";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripeInvoiceModule } from "../stripe-invoice/stripe-invoice.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { StripeUsageModule } from "../stripe-usage/stripe-usage.module";
import { StripeWebhookModule } from "../stripe-webhook/stripe-webhook.module";
import { BillingController } from "./controllers/billing.controller";
import { BillingService } from "./services/billing.service";
import { StripePaymentService } from "./services/stripe.payment.service";
import { StripePortalService } from "./services/stripe.portal.service";
import { StripeService } from "./services/stripe.service";

/**
 * StripeModule
 *
 * Core Stripe integration module providing the Stripe SDK client and billing orchestration.
 * This module focuses on payment setup, portal sessions, and payment method management.
 *
 * Usage-based billing functionality has been moved to StripeUsageModule.
 * Webhook processing functionality has been moved to StripeWebhookModule.
 *
 * Dependencies:
 * - StripeCustomerModule (customer management)
 * - StripeInvoiceModule (invoice management)
 * - StripeSubscriptionModule (subscription management)
 * - StripeUsageModule (usage-based billing)
 * - StripeWebhookModule (webhook processing)
 */
@Module({
  imports: [
    forwardRef(() => StripeCustomerModule),
    forwardRef(() => StripeInvoiceModule),
    forwardRef(() => StripeSubscriptionModule),
    forwardRef(() => StripeUsageModule),
    forwardRef(() => StripeWebhookModule),
  ],
  controllers: [BillingController],
  providers: [
    // Stripe API Services
    StripeService,
    StripePaymentService,
    StripePortalService,
    // Business Logic Services
    BillingService,
  ],
  exports: [
    // Stripe API Services
    StripeService,
    StripePaymentService,
    StripePortalService,
    // Business Logic Services
    BillingService,
  ],
})
export class StripeModule {}
