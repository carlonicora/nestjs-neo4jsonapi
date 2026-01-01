import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { Neo4JModule } from "../../core/neo4j/neo4j.module";
import { CompanyModule } from "../company/company.module";
import { StripeModule } from "../stripe/stripe.module";
import { UserModule } from "../user/user.module";
import { StripeCustomerController } from "./controllers/stripe-customer.controller";
import { StripeCustomerModel } from "./entities/stripe-customer.model";
import { StripeCustomerRepository } from "./repositories/stripe-customer.repository";
import { StripeCustomerSerialiser } from "./serialisers/stripe-customer.serialiser";
import { StripeCustomerAdminService } from "./services/stripe-customer-admin.service";
import { StripeCustomerApiService } from "./services/stripe-customer-api.service";

/**
 * StripeCustomerModule
 *
 * Manages Stripe customer functionality, providing CRUD operations
 * for billing customers with two-way sync between Stripe and local Neo4j database.
 *
 * Key Features:
 * - Customer management via admin REST API endpoints
 * - Stripe SDK integration for customer operations
 * - Neo4j persistence for customer data
 * - JSON:API compliant serialization
 * - Webhook-based customer sync from Stripe
 *
 * Module Structure:
 * - **Services**:
 *   - StripeCustomerApiService: Stripe SDK wrapper for API calls
 *   - StripeCustomerAdminService: Business logic for customer management
 * - **Repository**: StripeCustomerRepository for Neo4j operations
 * - **Serializer**: StripeCustomerSerialiser for JSON:API formatting
 *
 * Dependencies:
 * - Uses forwardRef with StripeModule to handle circular dependency
 * - StripeCustomerModule needs StripeService from StripeModule
 *
 * @example
 * ```typescript
 * // Import in another module
 * @Module({
 *   imports: [StripeCustomerModule],
 * })
 * export class SomeModule {}
 * ```
 */
@Module({
  imports: [Neo4JModule, JsonApiModule, CompanyModule, UserModule, forwardRef(() => StripeModule)],
  controllers: [StripeCustomerController],
  providers: [
    // Services
    StripeCustomerApiService,
    StripeCustomerAdminService,
    // Repository
    StripeCustomerRepository,
    // Serializer
    StripeCustomerSerialiser,
  ],
  exports: [
    // Services
    StripeCustomerApiService,
    StripeCustomerAdminService,
    // Repository
    StripeCustomerRepository,
  ],
})
export class StripeCustomerModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeCustomerModel);
  }
}
