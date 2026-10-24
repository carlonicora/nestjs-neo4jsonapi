import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../stripe-subscription/entities/stripe-subscription", () => ({
  StripeSubscriptionDescriptor: { model: { type: "stripe-subscriptions" }, relationships: {} },
}));
vi.mock("../../stripe-subscription/repositories/stripe-subscription.repository", () => ({
  StripeSubscriptionRepository: class StripeSubscriptionRepository {},
}));
vi.mock("../../stripe-webhook/services/stripe-webhook-notification.service", () => ({
  StripeWebhookNotificationService: class StripeWebhookNotificationService {},
}));
vi.mock("../../stripe-customer/services/stripe-customer-api.service", () => ({
  StripeCustomerApiService: class StripeCustomerApiService {},
}));

import { CardExpiryWarningService } from "../services/card-expiry-warning.service";

const NOW = new Date("2026-11-28T10:00:00.000Z");

const subscription = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "sub-node-1",
    stripeSubscriptionId: "sub_1",
    currentPeriodEnd: new Date("2026-12-03T09:00:00.000Z"),
    stripeCustomer: { id: "cus-node-1", stripeCustomerId: "cus_1" },
    ...overrides,
  }) as any;

const card = (expMonth: number, expYear: number) => ({ brand: "visa", last4: "4242", expMonth, expYear });

describe("CardExpiryWarningService", () => {
  let service: CardExpiryWarningService;
  let repository: { findRenewalsForCardCheck: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let customerApi: { getDefaultCard: ReturnType<typeof vi.fn> };
  let notifications: { sendCardExpiringEmail: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    repository = { findRenewalsForCardCheck: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) };
    customerApi = { getDefaultCard: vi.fn() };
    notifications = { sendCardExpiringEmail: vi.fn().mockResolvedValue(undefined) };
    service = new CardExpiryWarningService(
      {} as any,
      repository as any,
      {} as any,
      customerApi as any,
      notifications as any,
    );
  });

  it("warns when the card expires before the renewal", async () => {
    const sub = subscription();
    repository.findRenewalsForCardCheck.mockResolvedValue([sub]);
    customerApi.getDefaultCard.mockResolvedValue(card(11, 2026));

    const result = await service.processDue({ now: NOW });

    expect(customerApi.getDefaultCard).toHaveBeenCalledWith({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    expect(notifications.sendCardExpiringEmail).toHaveBeenCalledWith({
      stripeCustomerId: "cus_1",
      renewalDate: sub.currentPeriodEnd,
      cardBrand: "visa",
      cardLast4: "4242",
    });
    expect(repository.update).toHaveBeenCalledWith({ id: "sub-node-1", cardExpiryCheckedFor: sub.currentPeriodEnd });
    expect(notifications.sendCardExpiringEmail.mock.invocationCallOrder[0]).toBeLessThan(
      repository.update.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({ checked: 1, warned: 1 });
  });

  it("does not warn for a card valid through the renewal month", async () => {
    const sub = subscription();
    repository.findRenewalsForCardCheck.mockResolvedValue([sub]);
    customerApi.getDefaultCard.mockResolvedValue(card(12, 2026));

    const result = await service.processDue({ now: NOW });

    expect(notifications.sendCardExpiringEmail).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith({ id: "sub-node-1", cardExpiryCheckedFor: sub.currentPeriodEnd });
    expect(result).toEqual({ checked: 1, warned: 0 });
  });

  it("does not warn twice for the same renewal", async () => {
    const sub = subscription();
    customerApi.getDefaultCard.mockResolvedValue(card(11, 2026));
    // First run: the subscription is due. The service stores cardExpiryCheckedFor.
    repository.findRenewalsForCardCheck.mockResolvedValueOnce([sub]);
    // Second run: the repository filter excludes it because cardExpiryCheckedFor = currentPeriodEnd.
    repository.findRenewalsForCardCheck.mockResolvedValueOnce([]);

    await service.processDue({ now: NOW });
    await service.processDue({ now: new Date(NOW.getTime() + 60 * 60 * 1000) });

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.update).toHaveBeenCalledWith({ id: "sub-node-1", cardExpiryCheckedFor: sub.currentPeriodEnd });
    expect(notifications.sendCardExpiringEmail).toHaveBeenCalledTimes(1);
  });

  it("no card on file → no email, marked checked", async () => {
    const sub = subscription();
    repository.findRenewalsForCardCheck.mockResolvedValue([sub]);
    customerApi.getDefaultCard.mockResolvedValue(null);

    const result = await service.processDue({ now: NOW });

    expect(notifications.sendCardExpiringEmail).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith({ id: "sub-node-1", cardExpiryCheckedFor: sub.currentPeriodEnd });
    expect(result).toEqual({ checked: 1, warned: 0 });
  });

  it("a Stripe error on one subscription does not stop the rest", async () => {
    const failing = subscription({ id: "sub-node-1", stripeSubscriptionId: "sub_1" });
    const next = subscription({
      id: "sub-node-2",
      stripeSubscriptionId: "sub_2",
      stripeCustomer: { id: "cus-node-2", stripeCustomerId: "cus_2" },
    });
    repository.findRenewalsForCardCheck.mockResolvedValue([failing, next]);
    customerApi.getDefaultCard.mockRejectedValueOnce(new Error("Stripe is down")).mockResolvedValueOnce(card(11, 2026));
    const errorSpy = vi.spyOn((service as any).logger, "error").mockImplementation(() => undefined);

    const result = await service.processDue({ now: NOW });

    expect(errorSpy).toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.update).toHaveBeenCalledWith({ id: "sub-node-2", cardExpiryCheckedFor: next.currentPeriodEnd });
    expect(repository.update).not.toHaveBeenCalledWith(expect.objectContaining({ id: "sub-node-1" }));
    expect(notifications.sendCardExpiringEmail).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: "cus_2" }),
    );
    expect(result).toEqual({ checked: 1, warned: 1 });
  });

  it("window is seven days", async () => {
    await service.processDue({ now: NOW });

    expect(repository.findRenewalsForCardCheck).toHaveBeenCalledWith({
      now: NOW,
      before: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
  });
});
