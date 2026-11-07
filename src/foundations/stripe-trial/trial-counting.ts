import type { StripeSubscription } from "../stripe-subscription/entities/stripe-subscription";

/**
 * Subscription statuses that use up a company's free trial: a subscription in one of these
 * states means the company has had (or still has) a real subscription, so no new trial starts.
 *
 * `incomplete`, `incomplete_expired` and a `canceled` subscription that never had a trial are
 * abandoned attempts (an Upgrade that was never paid) and do not count.
 *
 * One list feeds both the TypeScript predicate below and any app Cypher that needs the same
 * rule (bind it as a parameter).
 */
export const TRIAL_COUNTING_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "unpaid", "paused"] as const;

/**
 * Whether this subscription uses up the company's free trial: it had a trial (`trialEnd` set)
 * or its status is in `TRIAL_COUNTING_SUBSCRIPTION_STATUSES`.
 */
export function isCountingTrialSubscription(subscription: Pick<StripeSubscription, "status" | "trialEnd">): boolean {
  if (subscription.trialEnd) return true;
  return (TRIAL_COUNTING_SUBSCRIPTION_STATUSES as readonly string[]).includes(subscription.status);
}
