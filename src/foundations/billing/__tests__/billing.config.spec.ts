import { describe, expect, it } from "vitest";
import { DEFAULT_BILLING_CONFIG, resolveBillingConfig } from "../interfaces/billing.config.interface";

describe("resolveBillingConfig", () => {
  it("returns the defaults when no config is given", () => {
    expect(resolveBillingConfig()).toEqual(DEFAULT_BILLING_CONFIG);
  });

  it("keeps the other two emails on when one is switched off", () => {
    const config = resolveBillingConfig({ emails: { cardExpiring: false } });

    expect(config.emails).toEqual({
      paymentFailed: true,
      cardExpiring: false,
      subscriptionEnded: true,
    });
  });

  it("keeps the other links when one is overridden", () => {
    const config = resolveBillingConfig({ links: { billing: "/billing" } });

    expect(config.links.billing).toBe("/billing");
    expect(config.links.subscribe).toBe("/settings/billing?action=subscribe");
    expect(config.links.paymentMethod).toBe("/settings/billing");
    expect(config.links.resubscribe).toBe("/settings/billing");
  });

  it("defaults the deletion delay to 30 days", () => {
    expect(resolveBillingConfig().deletion.afterSubscriptionEndedDays).toBe(30);
    expect(resolveBillingConfig({ deletion: {} }).deletion.afterSubscriptionEndedDays).toBe(30);
    expect(
      resolveBillingConfig({ deletion: { afterSubscriptionEndedDays: 365 } }).deletion.afterSubscriptionEndedDays,
    ).toBe(365);
  });

  it("keeps the sender off and grace on by default", () => {
    const config = resolveBillingConfig({});

    expect(config.emailSender).toEqual({ enabled: false, extraJobs: {} });
    expect(config.failedCardGrace).toBe(true);
  });

  it("does not mutate the defaults", () => {
    resolveBillingConfig({ emails: { paymentFailed: false }, links: { billing: "/x" } });

    expect(DEFAULT_BILLING_CONFIG.emails.paymentFailed).toBe(true);
    expect(DEFAULT_BILLING_CONFIG.links.billing).toBe("/settings/billing");
  });
});
