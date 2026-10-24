import { DataMeta } from "../../../common/interfaces/datamodel.interface";

export const stripeSubscriptionMeta: DataMeta = {
  type: "stripe-subscriptions",
  endpoint: "stripe-subscriptions",
  nodeName: "stripeSubscription",
  labelName: "StripeSubscription",
};

/** Route segment of POST stripe-subscriptions/:subscriptionId/sync */
export const STRIPE_SUBSCRIPTION_SYNC_SEGMENT = "sync";

/**
 * Stripe `cancellation_details.comment` on an unpaid first-payment attempt cancelled
 * because the GM retried. That subscription never granted anything, so its
 * `customer.subscription.deleted` webhook must not take anything away.
 */
export const STRIPE_UNPAID_ATTEMPT_CANCELLATION_COMMENT = "unpaid attempt replaced by a new one";
