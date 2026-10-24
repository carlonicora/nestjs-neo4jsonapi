import { HttpStatus } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import Stripe from "stripe";
import { StripeError } from "../../../stripe/errors/stripe.errors";
import { StripeSubscription } from "../../entities/stripe-subscription";
import {
  STRIPE_SUBSCRIPTION_DISCOUNT_BACKFILL_ID,
  StripeSubscriptionDiscountBackfillService,
} from "../stripe-subscription-discount-backfill.service";

const coupon = (overrides: Partial<Stripe.Coupon>): Stripe.Coupon =>
  ({
    id: "co_1",
    object: "coupon",
    percent_off: null,
    amount_off: null,
    currency: null,
    duration: "forever",
    duration_in_months: null,
    ...overrides,
  }) as Stripe.Coupon;

const withDiscount = (c: Stripe.Coupon | string, end: number | null = null): Stripe.Subscription =>
  ({
    id: "sub",
    discounts: [{ id: "di_1", object: "discount", end, source: { coupon: c, type: "coupon" } }],
  }) as unknown as Stripe.Subscription;

const node = (id: string, stripeSubscriptionId: string): StripeSubscription =>
  ({ id, stripeSubscriptionId, status: "active" }) as StripeSubscription;

const SUBS = {
  percent: node("local-percent", "sub_percent"),
  amount: node("local-amount", "sub_amount"),
  none: node("local-none", "sub_none"),
  deleted: node("local-deleted", "sub_deleted"),
  unreadable: node("local-unreadable", "sub_unreadable"),
};

const STRIPE: Record<string, () => Stripe.Subscription> = {
  sub_percent: () => withDiscount(coupon({ percent_off: 20, duration: "forever" })),
  sub_amount: () =>
    withDiscount(
      coupon({ amount_off: 500, currency: "eur", duration: "repeating", duration_in_months: 3 }),
      1735689600,
    ),
  sub_none: () => ({ id: "sub_none", discounts: [] }) as unknown as Stripe.Subscription,
  sub_deleted: () => {
    // What retrieveSubscription's HandleStripeErrors makes of Stripe's 404
    throw new StripeError("No such subscription: 'sub_deleted'", HttpStatus.BAD_REQUEST, "resource_missing");
  },
  // Discount ids only: not expanded, so not readable
  sub_unreadable: () => ({ id: "sub_unreadable", discounts: ["di_9"] }) as unknown as Stripe.Subscription,
};

describe("StripeSubscriptionDiscountBackfillService", () => {
  let stripeService: { isConfigured: ReturnType<typeof vi.fn> };
  let api: { retrieveSubscription: ReturnType<typeof vi.fn> };
  let subscriptionRepository: { findAll: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let backfillRepository: { isCompleted: ReturnType<typeof vi.fn>; markCompleted: ReturnType<typeof vi.fn> };
  let cls: { run: ReturnType<typeof vi.fn> };
  let logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let service: StripeSubscriptionDiscountBackfillService;

  beforeEach(() => {
    stripeService = { isConfigured: vi.fn().mockReturnValue(true) };
    api = { retrieveSubscription: vi.fn(async (id: string) => STRIPE[id]()) };
    subscriptionRepository = {
      findAll: vi.fn().mockResolvedValue(Object.values(SUBS)),
      update: vi.fn().mockResolvedValue({}),
    };
    backfillRepository = {
      isCompleted: vi.fn().mockResolvedValue(false),
      markCompleted: vi.fn().mockResolvedValue(undefined),
    };
    cls = { run: vi.fn((fn: () => unknown) => fn()) };
    logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    service = new StripeSubscriptionDiscountBackfillService(
      stripeService as any,
      api as any,
      subscriptionRepository as any,
      backfillRepository as any,
      cls as any,
      logger as any,
    );
  });

  it("writes the discount Stripe holds, null when there is none, and nothing else", async () => {
    const result = await service.run();

    expect(subscriptionRepository.update).toHaveBeenCalledTimes(3);
    expect(subscriptionRepository.update).toHaveBeenCalledWith({
      id: "local-percent",
      discount: {
        percentOff: 20,
        amountOff: null,
        currency: null,
        duration: "forever",
        durationInMonths: null,
        end: null,
      },
    });
    expect(subscriptionRepository.update).toHaveBeenCalledWith({
      id: "local-amount",
      discount: {
        percentOff: null,
        amountOff: 500,
        currency: "eur",
        duration: "repeating",
        durationInMonths: 3,
        end: new Date(1735689600 * 1000),
      },
    });
    expect(subscriptionRepository.update).toHaveBeenCalledWith({ id: "local-none", discount: null });

    // Discount fields only: never status, price, periods, quantity
    for (const [params] of subscriptionRepository.update.mock.calls) {
      expect(Object.keys(params).sort()).toEqual(["discount", "id"]);
    }

    expect(result).toEqual({ skipped: null, total: 5, updated: 3, missing: 1, unreadable: 1, failed: 0 });
  });

  it("leaves a subscription Stripe no longer has untouched, logs it and carries on", async () => {
    await service.run();

    expect(subscriptionRepository.update).not.toHaveBeenCalledWith(expect.objectContaining({ id: "local-deleted" }));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("sub_deleted not found in Stripe"));
    // the ones after it still ran
    expect(api.retrieveSubscription).toHaveBeenCalledWith("sub_unreadable");
  });

  it("leaves a subscription whose discount cannot be read untouched", async () => {
    await service.run();

    expect(subscriptionRepository.update).not.toHaveBeenCalledWith(expect.objectContaining({ id: "local-unreadable" }));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("sub_unreadable is unreadable"));
  });

  it("treats a raw Stripe 404 as missing too", async () => {
    subscriptionRepository.findAll.mockResolvedValue([SUBS.deleted]);
    api.retrieveSubscription.mockRejectedValue(Object.assign(new Error("No such subscription"), { statusCode: 404 }));

    const result = await service.run();

    expect(result.missing).toBe(1);
    expect(result.failed).toBe(0);
    expect(backfillRepository.markCompleted).toHaveBeenCalled();
  });

  it("asks Stripe one subscription at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    api.retrieveSubscription.mockImplementation(async (id: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return STRIPE[id]();
    });

    await service.run();

    expect(api.retrieveSubscription).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBe(1);
  });

  it("writes the marker once the run completes, so later boots skip it", async () => {
    await service.run();

    expect(backfillRepository.markCompleted).toHaveBeenCalledWith({
      id: STRIPE_SUBSCRIPTION_DISCOUNT_BACKFILL_ID,
      summary: "total=5 updated=3 missing=1 unreadable=1 failed=0",
    });
  });

  it("does nothing when the marker already exists", async () => {
    backfillRepository.isCompleted.mockResolvedValue(true);

    const result = await service.run();

    expect(result.skipped).toBe("already-completed");
    expect(subscriptionRepository.findAll).not.toHaveBeenCalled();
    expect(api.retrieveSubscription).not.toHaveBeenCalled();
    expect(backfillRepository.markCompleted).not.toHaveBeenCalled();
  });

  it("is a no-op when Stripe is not configured", async () => {
    stripeService.isConfigured.mockReturnValue(false);

    const result = await service.run();

    expect(result.skipped).toBe("stripe-not-configured");
    expect(backfillRepository.isCompleted).not.toHaveBeenCalled();
    expect(subscriptionRepository.findAll).not.toHaveBeenCalled();
    expect(api.retrieveSubscription).not.toHaveBeenCalled();
    expect(backfillRepository.markCompleted).not.toHaveBeenCalled();
  });

  it("does not write the marker after a transient failure, so the next boot retries", async () => {
    api.retrieveSubscription.mockImplementation(async (id: string) => {
      if (id === "sub_amount") {
        throw new StripeError("Payment service temporarily unavailable", HttpStatus.SERVICE_UNAVAILABLE);
      }
      return STRIPE[id]();
    });

    const result = await service.run();

    expect(result).toEqual({ skipped: null, total: 5, updated: 2, missing: 1, unreadable: 1, failed: 1 });
    expect(subscriptionRepository.update).not.toHaveBeenCalledWith(expect.objectContaining({ id: "local-amount" }));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("sub_amount failed"), expect.any(StripeError));
    expect(backfillRepository.markCompleted).not.toHaveBeenCalled();
  });

  it("keeps going when one database write fails", async () => {
    subscriptionRepository.update.mockImplementation(async ({ id }: { id: string }) => {
      if (id === "local-percent") throw new Error("neo4j down");
      return {};
    });

    const result = await service.run();

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(2);
  });

  it("runs inside a CLS context, since repository queries read it", async () => {
    await service.run();

    expect(cls.run).toHaveBeenCalledTimes(1);
  });

  it("starts in the background at bootstrap and never throws out of it", async () => {
    subscriptionRepository.findAll.mockRejectedValue(new Error("neo4j down"));

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith("Stripe subscription discount backfill aborted", expect.any(Error)),
    );
  });
});
