import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { Neo4JModule } from "../../core/neo4j/neo4j.module";
import { StripePriceModule } from "../stripe-price/stripe-price.module";
import { StripeModule } from "../stripe/stripe.module";
import { StripeSubscriptionController } from "./controllers/stripe-subscription.controller";
import { StripeSubscriptionModel } from "./entities/stripe-subscription.model";
import { StripeSubscriptionRepository } from "./repositories/stripe-subscription.repository";
import { StripeSubscriptionSerialiser } from "./serialisers/stripe-subscription.serialiser";
import { StripeSubscriptionAdminService } from "./services/stripe-subscription-admin.service";
import { StripeSubscriptionApiService } from "./services/stripe-subscription-api.service";

/**
 * Stripe Subscription Module
 *
 * Provides subscription management functionality for the Stripe billing system.
 * Handles subscription lifecycle including creation, updates, cancellations,
 * pausing/resuming, and plan changes with proration.
 *
 * Features:
 * - Create subscriptions with optional trial periods
 * - Cancel subscriptions (immediately or at period end)
 * - Pause and resume subscriptions
 * - Change subscription plans with automatic proration
 * - Preview proration amounts before making changes
 * - Sync subscription data from Stripe webhooks
 * - Filter subscriptions by status
 *
 * Dependencies:
 * - StripePriceModule: For price validation and lookups
 * - StripeModule: For Stripe API client and billing customer operations
 * - Neo4jModule: For database operations
 * - JsonApiModule: For JSON:API serialization
 *
 * Exports:
 * - StripeSubscriptionApiService: Stripe API operations
 * - StripeSubscriptionAdminService: Business logic and coordination
 * - StripeSubscriptionRepository: Database operations
 */
@Module({
  imports: [Neo4JModule, JsonApiModule, forwardRef(() => StripePriceModule), forwardRef(() => StripeModule)],
  controllers: [StripeSubscriptionController],
  providers: [
    StripeSubscriptionApiService,
    StripeSubscriptionAdminService,
    StripeSubscriptionRepository,
    StripeSubscriptionSerialiser,
  ],
  exports: [StripeSubscriptionApiService, StripeSubscriptionAdminService, StripeSubscriptionRepository],
})
export class StripeSubscriptionModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeSubscriptionModel);
  }
}
