import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { Neo4JModule } from "../../core/neo4j/neo4j.module";
import { SecurityModule } from "../../core/security/security.module";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { StripeModule } from "../stripe/stripe.module";
import { StripeInvoiceServiceLinesBackfillService } from "./backfills/stripe-invoice-service-lines-backfill.service";
import { StripeInvoiceController } from "./controllers/stripe-invoice.controller";
import { StripeInvoiceDescriptor } from "./entities/stripe-invoice";
import { StripeInvoiceRepository } from "./repositories/stripe-invoice.repository";
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
    Neo4JModule,
    JsonApiModule,
    SecurityModule,
    forwardRef(() => StripeCustomerModule),
    forwardRef(() => StripeSubscriptionModule),
    forwardRef(() => StripeModule),
  ],
  controllers: [StripeInvoiceController],
  providers: [
    StripeInvoiceApiService,
    StripeInvoiceAdminService,
    StripeInvoiceRepository,
    StripeInvoiceDescriptor.model.serialiser,
    // One-off plan and period fill-in: worker mode only; each invoice carries its own marker.
    createWorkerProvider(StripeInvoiceServiceLinesBackfillService),
  ],
  exports: [StripeInvoiceApiService, StripeInvoiceAdminService, StripeInvoiceRepository],
})
export class StripeInvoiceModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeInvoiceDescriptor.model);
  }
}
