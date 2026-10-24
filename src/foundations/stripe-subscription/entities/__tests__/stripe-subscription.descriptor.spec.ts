import { describe, expect, it } from "vitest";
import { StripeSubscriptionDescriptor } from "../stripe-subscription";

describe("StripeSubscriptionDescriptor", () => {
  it("declares every temporal field as datetime", () => {
    const temporal = [
      "currentPeriodStart",
      "currentPeriodEnd",
      "canceledAt",
      "trialStart",
      "trialEnd",
      "cardExpiryCheckedFor",
      "discountEnd",
    ] as const;

    for (const field of temporal) {
      expect(StripeSubscriptionDescriptor.fields[field]?.type, field).toBe("datetime");
    }
  });

  it("is company scoped", () => {
    expect(StripeSubscriptionDescriptor.isCompanyScoped).not.toBe(false);
  });

  it("relationships point out of the subscription", () => {
    const { stripeCustomer, stripePrice, createdBy } = StripeSubscriptionDescriptor.relationships;

    expect(stripeCustomer).toMatchObject({ direction: "out", relationship: "BELONGS_TO", cardinality: "one" });
    expect(stripePrice).toMatchObject({ direction: "out", relationship: "USES_PRICE", cardinality: "one" });
    expect(createdBy).toMatchObject({ direction: "out", relationship: "CREATED_BY", contextKey: "userId" });
  });

  it("maps a stored node to a typed subscription", () => {
    const mapped = StripeSubscriptionDescriptor.model.mapper({
      data: {
        id: "s1",
        stripeSubscriptionId: "sub_1",
        status: "active",
        currentPeriodStart: "2026-10-01T00:00:00.000Z",
        currentPeriodEnd: "2026-11-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        cardExpiryCheckedFor: "2027-01-01T00:00:00.000Z",
        quantity: 1,
      },
      record: {},
      entityFactory: {} as never,
    });

    expect(mapped.cardExpiryCheckedFor).toEqual(new Date("2027-01-01T00:00:00.000Z"));
    expect(mapped.canceledAt).toBeUndefined();
    expect(mapped.stripePrice).toBeUndefined();
  });
});
