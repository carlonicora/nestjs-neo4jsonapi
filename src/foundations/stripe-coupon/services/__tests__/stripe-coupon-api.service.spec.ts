import type Stripe from "stripe";
import type { Mocked } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StripeService } from "../../../stripe/services/stripe.service";
import { StripeCouponApiService } from "../stripe-coupon-api.service";

type MockStripe = {
  coupons: Mocked<Pick<Stripe["coupons"], "create" | "update" | "del" | "retrieve">>;
  promotionCodes: Mocked<Pick<Stripe["promotionCodes"], "create" | "update" | "retrieve">>;
};

describe("StripeCouponApiService", () => {
  const unix20270101 = 1798761600;
  let stripe: MockStripe;
  let stripeService: Mocked<Pick<StripeService, "getClient">>;
  let service: StripeCouponApiService;

  beforeEach(() => {
    stripe = {
      coupons: { create: vi.fn(), update: vi.fn(), del: vi.fn(), retrieve: vi.fn() },
      promotionCodes: { create: vi.fn(), update: vi.fn(), retrieve: vi.fn() },
    } as unknown as MockStripe;
    stripeService = { getClient: vi.fn().mockReturnValue(stripe) } as unknown as Mocked<
      Pick<StripeService, "getClient">
    >;
    service = new StripeCouponApiService(stripeService as unknown as StripeService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createCoupon", () => {
    it("sends a percentage coupon with product restriction, limit and redeem-by date", async () => {
      stripe.coupons.create.mockResolvedValue({ id: "co_1" } as any);

      await service.createCoupon({
        name: "Founding GM",
        discount: { discountType: "percent_off", percentOff: 20 },
        duration: { duration: "forever" },
        maxRedemptions: 50,
        stripeProductIds: ["prod_1"],
        redeemBy: new Date("2027-01-01T00:00:00Z"),
      });

      expect(stripe.coupons.create).toHaveBeenCalledWith({
        name: "Founding GM",
        percent_off: 20,
        duration: "forever",
        max_redemptions: 50,
        applies_to: { products: ["prod_1"] },
        redeem_by: unix20270101,
      });
      const sent = stripe.coupons.create.mock.calls[0][0] as Record<string, unknown>;
      expect(sent).not.toHaveProperty("amount_off");
      expect(sent).not.toHaveProperty("currency");
      expect(sent).not.toHaveProperty("duration_in_months");
    });

    it("sends a fixed amount with its currency and the month count for repeating", async () => {
      stripe.coupons.create.mockResolvedValue({ id: "co_2" } as any);

      await service.createCoupon({
        id: "FIVE-OFF",
        name: "Five off",
        discount: { discountType: "amount_off", amountOff: 500, currency: "eur" },
        duration: { duration: "repeating", durationInMonths: 3 },
        stripeProductIds: [],
      });

      expect(stripe.coupons.create).toHaveBeenCalledWith({
        id: "FIVE-OFF",
        name: "Five off",
        amount_off: 500,
        currency: "eur",
        duration: "repeating",
        duration_in_months: 3,
      });
    });
  });

  describe("createPromotionCode", () => {
    it("uses the promotion shape and maps restrictions and expiry", async () => {
      stripe.promotionCodes.create.mockResolvedValue({ id: "promo_1" } as any);

      await service.createPromotionCode({
        stripeCouponId: "co_1",
        code: "FOUNDER",
        firstTimeTransaction: false,
        minimumAmount: 499,
        minimumAmountCurrency: "eur",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      });

      expect(stripe.promotionCodes.create).toHaveBeenCalledWith({
        promotion: { type: "coupon", coupon: "co_1" },
        code: "FOUNDER",
        expires_at: unix20270101,
        restrictions: { first_time_transaction: false, minimum_amount: 499, minimum_amount_currency: "eur" },
      });
    });

    it("lets Stripe generate the code and sends no restrictions when none are given", async () => {
      stripe.promotionCodes.create.mockResolvedValue({ id: "promo_2" } as any);

      await service.createPromotionCode({ stripeCouponId: "co_1" });

      expect(stripe.promotionCodes.create).toHaveBeenCalledWith({ promotion: { type: "coupon", coupon: "co_1" } });
    });
  });

  it("retrievePromotionCode expands the coupon under promotion", async () => {
    stripe.promotionCodes.retrieve.mockResolvedValue({ id: "promo_1" } as any);

    await service.retrievePromotionCode("promo_1");

    expect(stripe.promotionCodes.retrieve).toHaveBeenCalledWith("promo_1", { expand: ["promotion.coupon"] });
  });

  it("setPromotionCodeActive updates only the active flag", async () => {
    stripe.promotionCodes.update.mockResolvedValue({ id: "promo_1" } as any);

    await service.setPromotionCodeActive({ stripePromotionCodeId: "promo_1", active: false });

    expect(stripe.promotionCodes.update).toHaveBeenCalledWith("promo_1", { active: false });
  });

  it("renameCoupon updates only the name", async () => {
    stripe.coupons.update.mockResolvedValue({ id: "co_1" } as any);

    await service.renameCoupon({ stripeCouponId: "co_1", name: "New name" });

    expect(stripe.coupons.update).toHaveBeenCalledWith("co_1", { name: "New name" });
  });

  it("deleteCoupon deletes in Stripe", async () => {
    stripe.coupons.del.mockResolvedValue({ id: "co_1", deleted: true } as any);

    await service.deleteCoupon("co_1");

    expect(stripe.coupons.del).toHaveBeenCalledWith("co_1");
  });
});
