import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { Neo4JModule } from "../../core/neo4j/neo4j.module";
import { StripeProductModule } from "../stripe-product/stripe-product.module";
import { StripePriceController } from "./controllers/stripe-price.controller";
import { StripePriceModel } from "./entities/stripe-price.model";
import { StripePriceRepository } from "./repositories/stripe-price.repository";
import { StripePriceSerialiser } from "./serialisers/stripe-price.serialiser";
import { StripePriceAdminService } from "./services/stripe-price-admin.service";

/**
 * StripePriceModule
 *
 * Module for Stripe price management functionality.
 * Provides admin endpoints and services for managing prices in the billing system.
 *
 * Dependencies:
 * - StripeProductModule - For product-price relationships
 */
@Module({
  imports: [Neo4JModule, JsonApiModule, forwardRef(() => StripeProductModule)],
  controllers: [StripePriceController],
  providers: [StripePriceAdminService, StripePriceRepository, StripePriceSerialiser],
  exports: [StripePriceAdminService, StripePriceRepository],
})
export class StripePriceModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripePriceModel);
  }
}
