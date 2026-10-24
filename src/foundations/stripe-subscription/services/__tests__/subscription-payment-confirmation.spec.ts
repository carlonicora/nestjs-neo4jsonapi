import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { subscriptionPaymentConfirmation } from "../subscription-payment-confirmation";

function subscriptionWith(status: string, latestInvoice: unknown): Stripe.Subscription {
  return { id: "sub_1", status, latest_invoice: latestInvoice } as unknown as Stripe.Subscription;
}

const currentInvoice = (status: string, payments: unknown[] = [], clientSecret: string | null = "pi_1_secret") => ({
  id: "in_1",
  status,
  confirmation_secret: clientSecret ? { client_secret: clientSecret, type: "payment_intent" } : null,
  payments: { data: payments },
});

const payment = (paymentIntent: unknown, isDefault = true) => ({
  is_default: isDefault,
  payment: { type: "payment_intent", payment_intent: paymentIntent },
});

describe("subscriptionPaymentConfirmation", () => {
  it("an incomplete subscription with an open invoice requires action (current API shape)", () => {
    const result = subscriptionPaymentConfirmation(
      subscriptionWith("incomplete", currentInvoice("open", [payment("pi_1")])),
    );

    expect(result).toEqual({ clientSecret: "pi_1_secret", paymentIntentId: "pi_1", requiresAction: true });
  });

  it("reads the PaymentIntent id from an expanded payment, preferring the default one", () => {
    const result = subscriptionPaymentConfirmation(
      subscriptionWith("incomplete", currentInvoice("open", [payment("pi_old", false), payment({ id: "pi_2" })])),
    );

    expect(result.paymentIntentId).toBe("pi_2");
  });

  it("a past_due subscription with an open invoice requires action (trial upgrade asking for 3D Secure)", () => {
    const result = subscriptionPaymentConfirmation(
      subscriptionWith("past_due", currentInvoice("open", [payment("pi_1")])),
    );

    expect(result.requiresAction).toBe(true);
  });

  it("an active subscription with a paid invoice needs nothing", () => {
    const result = subscriptionPaymentConfirmation(
      subscriptionWith("active", currentInvoice("paid", [payment("pi_1")])),
    );

    expect(result.requiresAction).toBe(false);
  });

  it("an incomplete subscription whose invoice is no longer open needs nothing", () => {
    const result = subscriptionPaymentConfirmation(subscriptionWith("incomplete", currentInvoice("paid")));

    expect(result.requiresAction).toBe(false);
  });

  it("an open invoice without a client secret cannot be confirmed", () => {
    const result = subscriptionPaymentConfirmation(subscriptionWith("incomplete", currentInvoice("open", [], null)));

    expect(result).toEqual({ clientSecret: null, paymentIntentId: null, requiresAction: false });
  });

  it("a trialing subscription needs nothing", () => {
    const result = subscriptionPaymentConfirmation(subscriptionWith("trialing", currentInvoice("paid", [], null)));

    expect(result.requiresAction).toBe(false);
  });

  it("reads the legacy invoice.payment_intent of a pinned older API version", () => {
    const result = subscriptionPaymentConfirmation(
      subscriptionWith("incomplete", {
        id: "in_1",
        status: "open",
        payment_intent: { id: "pi_legacy", client_secret: "pi_legacy_secret" },
      }),
    );

    expect(result).toEqual({ clientSecret: "pi_legacy_secret", paymentIntentId: "pi_legacy", requiresAction: true });
  });

  it("an unexpanded or missing invoice needs nothing", () => {
    expect(subscriptionPaymentConfirmation(subscriptionWith("incomplete", "in_1")).requiresAction).toBe(false);
    expect(subscriptionPaymentConfirmation(subscriptionWith("incomplete", null)).requiresAction).toBe(false);
  });
});
