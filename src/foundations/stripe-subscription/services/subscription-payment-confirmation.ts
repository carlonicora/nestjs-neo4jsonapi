import Stripe from "stripe";

/**
 * What a subscription create / update must expand so the first invoice's
 * payment can be confirmed in the browser.
 *
 * Since Stripe API 2025-03-31 (basil) an invoice has no `payment_intent`: the
 * client secret is on `confirmation_secret` and the PaymentIntent id under
 * `payments`. `latest_invoice.payment_intent` stays for an app that pins an
 * older `STRIPE_API_VERSION`; a newer version ignores it.
 */
export const SUBSCRIPTION_PAYMENT_EXPAND = [
  "latest_invoice.confirmation_secret",
  "latest_invoice.payments",
  "latest_invoice.payment_intent",
] as const;

export type SubscriptionPaymentConfirmation = {
  clientSecret: string | null;
  paymentIntentId: string | null;
  requiresAction: boolean;
};

type LegacyInvoice = Stripe.Invoice & { payment_intent?: string | Stripe.PaymentIntent | null };

/** The PaymentIntent id of the invoice's default payment, current or legacy shape. */
function paymentIntentIdOf(invoice: LegacyInvoice): string | null {
  const payments = invoice.payments?.data ?? [];
  const entry = payments.find((p) => p.is_default) ?? payments[0];
  const fromPayments = entry?.payment?.payment_intent;
  if (fromPayments) return typeof fromPayments === "string" ? fromPayments : fromPayments.id;

  const legacy = invoice.payment_intent;
  if (legacy) return typeof legacy === "string" ? legacy : legacy.id;
  return null;
}

/** The client secret of the invoice's payment, current or legacy shape. */
function clientSecretOf(invoice: LegacyInvoice): string | null {
  const secret = invoice.confirmation_secret;
  if (secret?.client_secret) return secret.client_secret;

  const legacy = invoice.payment_intent;
  if (legacy && typeof legacy !== "string" && legacy.client_secret) return legacy.client_secret;
  return null;
}

/**
 * Whether the browser must confirm the subscription's first payment, and with
 * which client secret.
 *
 * It must when the latest invoice is still `open` (not paid) and the
 * subscription waits on it: `incomplete` after a create with
 * `payment_behavior: "default_incomplete"`, or `past_due` after a trial upgrade
 * whose card asked for 3D Secure.
 */
export function subscriptionPaymentConfirmation(subscription: Stripe.Subscription): SubscriptionPaymentConfirmation {
  const none: SubscriptionPaymentConfirmation = { clientSecret: null, paymentIntentId: null, requiresAction: false };

  const latestInvoice = subscription.latest_invoice;
  if (!latestInvoice || typeof latestInvoice === "string") return none;

  const invoice = latestInvoice as LegacyInvoice;
  const clientSecret = clientSecretOf(invoice);
  const paymentIntentId = paymentIntentIdOf(invoice);

  const waitsOnPayment = subscription.status === "incomplete" || subscription.status === "past_due";
  const requiresAction = waitsOnPayment && invoice.status === "open" && clientSecret !== null;

  return { clientSecret, paymentIntentId, requiresAction };
}
