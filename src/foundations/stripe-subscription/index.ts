/**
 * Stripe Subscription Module - Public API
 *
 * This barrel file exports the public API of the stripe-subscription module.
 * Use these exports when importing stripe-subscription functionality from other modules.
 */

// Module
export { StripeSubscriptionModule } from "./stripe-subscription.module";

// Controllers
export { StripeSubscriptionController } from "./controllers/stripe-subscription.controller";

// Services
export { StripeSubscriptionApiService } from "./services/stripe-subscription-api.service";
export { StripeSubscriptionAdminService } from "./services/stripe-subscription-admin.service";

// Repositories
export { StripeSubscriptionRepository } from "./repositories/stripe-subscription.repository";

// Entities
export {
  StripeSubscription,
  StripeSubscriptionDiscountDuration,
  StripeSubscriptionStatus,
} from "./entities/stripe-subscription.entity";
export {
  STRIPE_SUBSCRIPTION_DISCOUNT_EXPAND,
  StripeSubscriptionDiscount,
  discountFromStripeSubscription,
} from "./entities/stripe-subscription.discount";
export { StripeSubscriptionModel } from "./entities/stripe-subscription.model";
export { STRIPE_SUBSCRIPTION_SYNC_SEGMENT, stripeSubscriptionMeta } from "./entities/stripe-subscription.meta";
export { mapStripeSubscription } from "./entities/stripe-subscription.map";

// DTOs
export {
  StripeSubscriptionDTO,
  StripeSubscriptionPostDTO,
  StripeSubscriptionPostDataDTO,
  StripeSubscriptionPostAttributesDTO,
  StripeSubscriptionCancelDTO,
  StripeSubscriptionCancelDataDTO,
  StripeSubscriptionCancelAttributesDTO,
  StripeSubscriptionChangePlanDTO,
  StripeSubscriptionChangePlanDataDTO,
  StripeSubscriptionChangePlanAttributesDTO,
} from "./dtos/stripe-subscription.dto";

// Serializers
export { StripeSubscriptionSerialiser } from "./serialisers/stripe-subscription.serialiser";
