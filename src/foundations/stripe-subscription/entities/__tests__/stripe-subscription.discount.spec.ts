import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { discountFromStripeSubscription, discountQueryParams } from "../stripe-subscription.discount";
import { mapStripeSubscription } from "../stripe-subscription.map";

const coupon = (overrides: Partial<Stripe.Coupon> = {}): Stripe.Coupon =>
  ({
    id: "co_founding",
    object: "coupon",
    percent_off: 20,
    amount_off: null,
    currency: null,
    duration: "forever",
    duration_in_months: null,
    ...overrides,
  }) as Stripe.Coupon;

const discount = (c: Stripe.Coupon | string, end: number | null = null): Stripe.Discount =>
  ({
    id: "di_1",
    object: "discount",
    end,
    promotion_code: "promo_1",
    source: { coupon: c, type: "coupon" },
    start: 1704067200,
  }) as unknown as Stripe.Discount;

describe("discountFromStripeSubscription", () => {
  it("reads a percentage coupon that lasts forever", () => {
    expect(discountFromStripeSubscription({ discounts: [discount(coupon())] })).toEqual({
      percentOff: 20,
      amountOff: null,
      currency: null,
      duration: "forever",
      durationInMonths: null,
      end: null,
    });
  });

  it("reads a fixed-amount repeating coupon and when it ends", () => {
    const result = discountFromStripeSubscription({
      discounts: [
        discount(
          coupon({ percent_off: null, amount_off: 500, currency: "eur", duration: "repeating", duration_in_months: 3 }),
          1711929600,
        ),
      ],
    });

    expect(result).toEqual({
      percentOff: null,
      amountOff: 500,
      currency: "eur",
      duration: "repeating",
      durationInMonths: 3,
      end: new Date(1711929600 * 1000),
    });
  });

  it("returns null when Stripe says there is no discount, so the stored one is cleared", () => {
    expect(discountFromStripeSubscription({ discounts: [] })).toBeNull();
  });

  it("returns undefined when the discounts are ids only, so the stored one is kept", () => {
    expect(discountFromStripeSubscription({ discounts: ["di_1"] })).toBeUndefined();
  });

  it("returns undefined when the coupon is not expanded", () => {
    expect(discountFromStripeSubscription({ discounts: [discount("co_founding")] })).toBeUndefined();
  });

  it("returns undefined for a duration Stripe added after this code, so the stored one is kept", () => {
    expect(
      discountFromStripeSubscription({
        discounts: [discount(coupon({ duration: "variable" as Stripe.Coupon.Duration }))],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the payload has no discounts field", () => {
    expect(discountFromStripeSubscription({} as Pick<Stripe.Subscription, "discounts">)).toBeUndefined();
  });

  it("reads the coupon from the discount itself on API versions before source.coupon", () => {
    const legacy = { id: "di_1", object: "discount", end: null, coupon: coupon({ percent_off: 10 }) };
    expect(discountFromStripeSubscription({ discounts: [legacy as unknown as Stripe.Discount] })?.percentOff).toBe(10);
  });
});

describe("discountQueryParams", () => {
  it("turns the discount into Cypher params with the end as an ISO string", () => {
    expect(
      discountQueryParams({
        percentOff: null,
        amountOff: 500,
        currency: "eur",
        duration: "repeating",
        durationInMonths: 3,
        end: new Date("2024-04-01T00:00:00.000Z"),
      }),
    ).toEqual({
      discountPercentOff: null,
      discountAmountOff: 500,
      discountCurrency: "eur",
      discountDuration: "repeating",
      discountDurationInMonths: 3,
      discountEnd: "2024-04-01T00:00:00.000Z",
    });
  });

  it("sets every field to null when there is no discount", () => {
    expect(Object.values(discountQueryParams(null)).every((value) => value === null)).toBe(true);
  });
});

describe("mapStripeSubscription discount fields", () => {
  const base = {
    id: "sub-1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    currentPeriodStart: "2024-01-01T00:00:00.000Z",
    currentPeriodEnd: "2024-02-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    quantity: 1,
  };

  it("maps the stored discount, the end as a Date", () => {
    const mapped = mapStripeSubscription({
      data: {
        ...base,
        discountPercentOff: 20,
        discountAmountOff: null,
        discountCurrency: null,
        discountDuration: "repeating",
        discountDurationInMonths: 6,
        discountEnd: "2024-07-01T00:00:00.000Z",
      },
      record: {},
      entityFactory: {} as never,
    });

    expect(mapped.discountPercentOff).toBe(20);
    expect(mapped.discountAmountOff).toBeUndefined();
    expect(mapped.discountDuration).toBe("repeating");
    expect(mapped.discountDurationInMonths).toBe(6);
    expect(mapped.discountEnd).toEqual(new Date("2024-07-01T00:00:00.000Z"));
  });

  it("leaves every discount field undefined when none is stored", () => {
    const mapped = mapStripeSubscription({ data: base, record: {}, entityFactory: {} as never });

    expect(mapped.discountPercentOff).toBeUndefined();
    expect(mapped.discountAmountOff).toBeUndefined();
    expect(mapped.discountCurrency).toBeUndefined();
    expect(mapped.discountDuration).toBeUndefined();
    expect(mapped.discountDurationInMonths).toBeUndefined();
    expect(mapped.discountEnd).toBeUndefined();
  });
});
