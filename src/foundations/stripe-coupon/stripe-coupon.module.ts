import { Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { CacheModule } from "../../core/cache/cache.module";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { Neo4JModule } from "../../core/neo4j/neo4j.module";
import { SecurityModule } from "../../core/security/security.module";
import { AuditModule } from "../audit/audit.module";
import { StripeCustomerModule } from "../stripe-customer/stripe-customer.module";
import { StripePriceModule } from "../stripe-price/stripe-price.module";
import { StripeProductModule } from "../stripe-product/stripe-product.module";
import { StripeSubscriptionModule } from "../stripe-subscription/stripe-subscription.module";
import { StripeModule } from "../stripe/stripe.module";
import { StripeCouponCodeCheckoutController } from "./controllers/stripe-coupon-code-checkout.controller";
import { StripeCouponCodeController } from "./controllers/stripe-coupon-code.controller";
import { StripeCouponController } from "./controllers/stripe-coupon.controller";
import { StripeCouponPublicController } from "./controllers/stripe-coupon.public.controller";
import { StripeCouponDescriptor } from "./entities/stripe-coupon";
import { StripeCouponCodeDescriptor } from "./entities/stripe-coupon-code";
import { StripeCouponOfferDescriptor } from "./entities/stripe-coupon-offer";
import { StripeCouponCodeRepository } from "./repositories/stripe-coupon-code.repository";
import { StripeCouponRepository } from "./repositories/stripe-coupon.repository";
import { StripeCouponApiService } from "./services/stripe-coupon-api.service";
import { StripeCouponCodeCheckoutService } from "./services/stripe-coupon-code-checkout.service";
import { StripeCouponCodeService } from "./services/stripe-coupon-code.service";
import { StripeCouponOfferService } from "./services/stripe-coupon-offer.service";
import { StripeCouponService } from "./services/stripe-coupon.service";

/**
 * StripeCouponModule — admin-managed Stripe coupons and their customer-facing codes.
 *
 * - Coupons and codes are created in Stripe first and mirrored as nodes
 *   (`StripeCoupon` -[:HAS_CODE]-> `StripeCouponCode`), like products
 * - One code at a time can be "Apply automatically"; the subscription service
 *   attaches it at a GM's first payment (`StripeCouponCodeCheckoutService`)
 * - A public read of the automatic code's places left (`StripeCouponPublicController`)
 */
@Module({
  imports: [
    Neo4JModule,
    JsonApiModule,
    SecurityModule,
    CacheModule,
    AuditModule,
    forwardRef(() => StripeModule),
    forwardRef(() => StripeProductModule),
    forwardRef(() => StripePriceModule),
    forwardRef(() => StripeCustomerModule),
    forwardRef(() => StripeSubscriptionModule),
  ],
  // The checkout controller comes first: its literal `stripe-coupon-codes/automatic`
  // route must register before `stripe-coupon-codes/:codeId`.
  controllers: [
    StripeCouponCodeCheckoutController,
    StripeCouponController,
    StripeCouponCodeController,
    StripeCouponPublicController,
  ],
  providers: [
    StripeCouponDescriptor.model.serialiser,
    StripeCouponCodeDescriptor.model.serialiser,
    StripeCouponOfferDescriptor.model.serialiser,
    StripeCouponApiService,
    StripeCouponRepository,
    StripeCouponCodeRepository,
    StripeCouponService,
    StripeCouponCodeService,
    StripeCouponCodeCheckoutService,
    StripeCouponOfferService,
  ],
  exports: [StripeCouponCodeCheckoutService, StripeCouponCodeRepository, StripeCouponApiService],
})
export class StripeCouponModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(StripeCouponDescriptor.model);
    modelRegistry.register(StripeCouponCodeDescriptor.model);
    // Synthetic resource (never a node): buildList needs it in the registry
    modelRegistry.register(StripeCouponOfferDescriptor.model);
  }
}
