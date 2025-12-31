import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { StripeModule } from "../stripe/stripe.module";
import { StripeInvoiceController } from "./controllers/stripe-invoice.controller";
import { StripeInvoiceModel } from "./entities/stripe-invoice.model";
import { StripeInvoiceRepository } from "./repositories/stripe-invoice.repository";
import { StripeInvoiceSerialiser } from "./serialisers/stripe-invoice.serialiser";
import { StripeInvoiceAdminService } from "./services/stripe-invoice-admin.service";
import { StripeInvoiceApiService } from "./services/stripe-invoice-api.service";

/**
 * StripeInvoiceModule
 *
 * Manages Stripe invoice functionality including:
 * - Invoice retrieval and listing
 * - Upcoming invoice previews
 * - Invoice synchronization from Stripe webhooks
 * - JSON:API serialization of invoice data
 *
 * This module is separated from the main Stripe module to provide better
 * organization and maintain clear domain boundaries.
 *
 * Dependencies:
 * - StripeModule (via forwardRef to avoid circular dependencies)
 * - StripeSubscriptionModule (for invoice-subscription relationships)
 * - JsonApiModule (for JSON:API serialization)
 */
@Module({
  imports: [
    JsonApiModule,
    forwardRef(() => StripeCustomerModule),
    forwardRef(() => StripeSubscriptionModule),
    forwardRef(() => StripeModule),
  ],
  controllers: [StripeInvoiceController],
  providers: [StripeInvoiceApiService, StripeInvoiceAdminService, StripeInvoiceRepository, StripeInvoiceSerialiser],
  exports: [StripeInvoiceApiService, StripeInvoiceAdminService, StripeInvoiceRepository],
})
export class StripeInvoiceModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeInvoiceModel);
  }
}
