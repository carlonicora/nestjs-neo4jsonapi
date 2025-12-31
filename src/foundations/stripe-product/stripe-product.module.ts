import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { Neo4JModule } from "../../core/neo4j/neo4j.module";
import { StripeModule } from "../stripe/stripe.module";
import { StripeProductController } from "./controllers/stripe-product.controller";
import { StripeProductModel } from "./entities/stripe-product.model";
import { StripeProductRepository } from "./repositories/stripe-product.repository";
import { StripeProductSerialiser } from "./serialisers/stripe-product.serialiser";
import { StripeProductAdminService } from "./services/stripe-product-admin.service";
import { StripeProductApiService } from "./services/stripe-product-api.service";

/**
 * StripeProductModule
 *
 * Manages Stripe product catalog functionality, providing CRUD operations
 * for billing products with two-way sync between Stripe and local Neo4j database.
 *
 * Key Features:
 * - Product management via admin REST API endpoints
 * - Stripe SDK integration for product operations
 * - Neo4j persistence for product catalog
 * - JSON:API compliant serialization
 * - Webhook-based product sync from Stripe
 * - Active/inactive product filtering
 *
 * Module Structure:
 * - **Controllers**: StripeProductController for admin endpoints
 * - **Services**:
 *   - StripeProductApiService: Stripe SDK wrapper for API calls
 *   - StripeProductAdminService: Business logic for product management
 * - **Repository**: StripeProductRepository for Neo4j operations
 * - **Serializer**: StripeProductSerialiser for JSON:API formatting
 *
 * Dependencies:
 * - Uses forwardRef with StripeModule to handle circular dependency
 * - StripeProductModule needs StripeService from StripeModule
 * - StripeModule needs StripeProductRepository for billing operations
 *
 * @example
 * ```typescript
 * // Import in another module
 * @Module({
 *   imports: [StripeProductModule],
 * })
 * export class SomeModule {}
 * ```
 */
@Module({
  imports: [Neo4JModule, JsonApiModule, forwardRef(() => StripeModule)],
  controllers: [StripeProductController],
  providers: [
    // Services
    StripeProductApiService,
    StripeProductAdminService,
    // Repository
    StripeProductRepository,
    // Serializer
    StripeProductSerialiser,
  ],
  exports: [
    // Services
    StripeProductApiService,
    StripeProductAdminService,
    // Repository
    StripeProductRepository,
  ],
})
export class StripeProductModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeProductModel);
  }
}
