import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { CacheModule } from "../../core/cache/cache.module";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { Neo4JModule } from "../../core/neo4j/neo4j.module";
import { CompanyModule } from "../company/company.module";
import { StripeCouponModule } from "../stripe-coupon/stripe-coupon.module";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripePriceModule } from "../stripe-price/stripe-price.module";
import { StripeModule } from "../stripe/stripe.module";
import { StripeSubscriptionBackfillRepository } from "./backfills/stripe-subscription-backfill.repository";
import { StripeSubscriptionDiscountBackfillService } from "./backfills/stripe-subscription-discount-backfill.service";
import { StripeSubscriptionController } from "./controllers/stripe-subscription.controller";
import { StripeSubscriptionModel } from "./entities/stripe-subscription.model";
import { StripeSubscriptionRepository } from "./repositories/stripe-subscription.repository";
import { StripeSubscriptionSerialiser } from "./serialisers/stripe-subscription.serialiser";
import { StripeSubscriptionAdminService } from "./services/stripe-subscription-admin.service";
import { StripeSubscriptionApiService } from "./services/stripe-subscription-api.service";
import { FeatureSyncService } from "./services/feature-sync.service";
import { TokenAllocationService } from "./services/token-allocation.service";

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
 * - Token allocation on subscription payment and plan changes
 *
 * Dependencies:
 * - StripePriceModule: For price validation and lookups
 * - StripeModule: For Stripe API client and billing customer operations
 * - StripeCustomerModule: For customer lookups
 * - CompanyModule: For company token updates
 * - Neo4jModule: For database operations
 * - JsonApiModule: For JSON:API serialization
 *
 * Exports:
 * - StripeSubscriptionApiService: Stripe API operations
 * - StripeSubscriptionAdminService: Business logic and coordination
 * - StripeSubscriptionRepository: Database operations
 * - TokenAllocationService: Token allocation on subscription events
 */
@Module({
  imports: [
    Neo4JModule,
    JsonApiModule,
    CacheModule,
    forwardRef(() => CompanyModule),
    forwardRef(() => StripeCustomerModule),
    forwardRef(() => StripePriceModule),
    forwardRef(() => StripeModule),
    forwardRef(() => StripeCouponModule),
  ],
  controllers: [StripeSubscriptionController],
  providers: [
    StripeSubscriptionApiService,
    StripeSubscriptionAdminService,
    StripeSubscriptionRepository,
    StripeSubscriptionSerialiser,
    TokenAllocationService,
    FeatureSyncService,
    StripeSubscriptionBackfillRepository,
    // One-off discount backfill: worker mode only, once per database (marker node).
    createWorkerProvider(StripeSubscriptionDiscountBackfillService),
  ],
  exports: [
    StripeSubscriptionApiService,
    StripeSubscriptionAdminService,
    StripeSubscriptionRepository,
    TokenAllocationService,
    FeatureSyncService,
  ],
})
export class StripeSubscriptionModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeSubscriptionModel);
  }
}
