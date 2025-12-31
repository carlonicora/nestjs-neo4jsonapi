import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { Neo4JModule } from "../../core/neo4j/neo4j.module";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { StripeModule } from "../stripe/stripe.module";
import { StripeUsageController } from "./controllers/stripe-usage.controller";
import { StripeUsageRecordModel } from "./entities/stripe-usage-record.model";
import { StripeUsageRecordRepository } from "./repositories/stripe-usage-record.repository";
import { StripeUsageRecordSerialiser } from "./serialisers/stripe-usage-record.serialiser";
import { StripeUsageAdminService } from "./services/stripe-usage-admin.service";
import { StripeUsageApiService } from "./services/stripe-usage-api.service";

/**
 * StripeUsageModule
 *
 * Manages usage-based billing functionality including:
 * - Usage event reporting to Stripe V2 Billing Meters API
 * - Local usage record persistence for tracking
 * - Usage summaries and analytics
 * - Meter configuration listing
 *
 * This module is separated from the main Stripe module to provide better
 * organization and maintain clear domain boundaries.
 *
 * Dependencies:
 * - StripeModule (via forwardRef for StripeService access)
 * - StripeSubscriptionModule (for subscription relationships)
 * - StripeCustomerModule (for customer validation)
 * - JsonApiModule (for JSON:API serialization)
 */
@Module({
  imports: [
    Neo4JModule,
    JsonApiModule,
    forwardRef(() => StripeModule),
    forwardRef(() => StripeSubscriptionModule),
    forwardRef(() => StripeCustomerModule),
  ],
  controllers: [StripeUsageController],
  providers: [
    StripeUsageApiService,
    StripeUsageAdminService,
    StripeUsageRecordRepository,
    StripeUsageRecordSerialiser,
  ],
  exports: [
    StripeUsageApiService,
    StripeUsageAdminService,
    StripeUsageRecordRepository,
  ],
})
export class StripeUsageModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeUsageRecordModel);
  }
}
