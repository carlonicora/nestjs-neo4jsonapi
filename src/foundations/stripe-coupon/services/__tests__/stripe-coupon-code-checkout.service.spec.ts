import { afterEach, beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import type Stripe from "stripe";
import type { ClsService } from "nestjs-cls";
import type { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import type { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
import type { StripePriceRepository } from "../../../stripe-price/repositories/stripe-price.repository";
import type { StripeSubscriptionRepository } from "../../../stripe-subscription/repositories/stripe-subscription.repository";
import type { StripeCoupon } from "../../entities/stripe-coupon";
import type { StripeCouponCode } from "../../entities/stripe-coupon-code";
import type { StripeCouponCodeRepository } from "../../repositories/stripe-coupon-code.repository";
import type { StripeCouponRepository } from "../../repositories/stripe-coupon.repository";
import type { StripeCouponApiService } from "../stripe-coupon-api.service";
import { StripeCouponCodeCheckoutService } from "../stripe-coupon-code-checkout.service";

const NOW = new Date("2026-10-24T12:00:00Z");

const buildCoupon = (overrides: Partial<StripeCoupon> = {}): StripeCoupon =>
  ({
    id: "coupon_1",
    type: "stripe-coupons",
    stripeCouponId: "co_1",
    name: "Founding GM",
    discountType: "percent_off",
    percentOff: 20,
    duration: "forever",
    stripeProductIds: ["prod_std"],
    maxRedemptions: 50,
    timesRedeemed: 13,
    valid: true,
    ...overrides,
  }) as StripeCoupon;

const buildCode = (overrides: Partial<StripeCouponCode> = {}, coupon: StripeCoupon = buildCoupon()): StripeCouponCode =>
  ({
    id: "code_1",
    type: "stripe-coupon-codes",
    stripePromotionCodeId: "promo_1",
    code: "FOUNDER",
    active: true,
    automatic: true,
    firstTimeTransaction: false,
    timesRedeemed: 13,
    coupon,
    ...overrides,
  }) as StripeCouponCode;

const buildPrice = (overrides: Record<string, any> = {}) => ({
  id: "price_db_1",
  stripePriceId: "price_1",
  priceType: "recurring",
  isTrial: false,
  stripeProduct: { stripeProductId: "prod_std" },
  unitAmount: 999,
  currency: "eur",
  ...overrides,
});

const CUSTOMER = { id: "customer_db_1", stripeCustomerId: "cus_1" };
const TRIAL_SUBSCRIPTION = {
  id: "sub_db_1",
  status: "trialing",
  stripePrice: { priceType: "recurring", isTrial: true },
};

describe("StripeCouponCodeCheckoutService", () => {
  let service: StripeCouponCodeCheckoutService;
  let jsonApiService: Mocked<Pick<JsonApiService, "buildList">>;
  let codeRepository: Mocked<
    Pick<StripeCouponCodeRepository, "findAutomatic" | "findByStripePromotionCodeId" | "patch">
  >;
  let couponRepository: Mocked<Pick<StripeCouponRepository, "patch">>;
  let couponApi: Mocked<Pick<StripeCouponApiService, "retrievePromotionCode" | "retrieveCoupon">>;
  let priceRepository: Mocked<Pick<StripePriceRepository, "findById">>;
  let customerRepository: Mocked<Pick<StripeCustomerRepository, "findByCompanyId">>;
  let subscriptionRepository: Mocked<Pick<StripeSubscriptionRepository, "findByStripeCustomerId">>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    jsonApiService = { buildList: vi.fn().mockResolvedValue({ data: [] }) };
    codeRepository = {
      findAutomatic: vi.fn().mockResolvedValue(buildCode()),
      findByStripePromotionCodeId: vi.fn(),
      patch: vi.fn().mockResolvedValue(undefined),
    };
    couponRepository = { patch: vi.fn().mockResolvedValue(undefined) };
    couponApi = { retrievePromotionCode: vi.fn(), retrieveCoupon: vi.fn() };
    priceRepository = { findById: vi.fn().mockResolvedValue(buildPrice()) };
    customerRepository = { findByCompanyId: vi.fn().mockResolvedValue(CUSTOMER) };
    subscriptionRepository = { findByStripeCustomerId: vi.fn().mockResolvedValue([TRIAL_SUBSCRIPTION]) };

    service = new StripeCouponCodeCheckoutService(
      jsonApiService as unknown as JsonApiService,
      codeRepository as unknown as StripeCouponCodeRepository,
      {} as ClsService,
      couponRepository as unknown as StripeCouponRepository,
      couponApi as unknown as StripeCouponApiService,
      priceRepository as unknown as StripePriceRepository,
      customerRepository as unknown as StripeCustomerRepository,
      subscriptionRepository as unknown as StripeSubscriptionRepository,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const find = () => service.findAutomaticForPrice({ companyId: "company_1", priceId: "price_db_1" });

  describe("findAutomaticForPrice", () => {
    it("returns the code for a trial customer", async () => {
      const result = await find();

      expect(result?.id).toBe("code_1");
      expect(priceRepository.findById).toHaveBeenCalledWith({ id: "price_db_1" });
      expect(customerRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: "company_1" });
      expect(subscriptionRepository.findByStripeCustomerId).toHaveBeenCalledWith({ stripeCustomerId: "customer_db_1" });
    });

    it("returns null when there is no automatic code", async () => {
      codeRepository.findAutomatic.mockResolvedValue(null);
      expect(await find()).toBeNull();
    });

    it("returns null for a product outside appliesTo", async () => {
      priceRepository.findById.mockResolvedValue(buildPrice({ stripeProduct: { stripeProductId: "prod_pro" } }) as any);
      expect(await find()).toBeNull();
    });

    it("returns null for an expired code", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({ expiresAt: new Date("2026-10-23T12:00:00Z") }));
      expect(await find()).toBeNull();
    });

    it("returns null when places left is 0", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({}, buildCoupon({ timesRedeemed: 50 })));
      expect(await find()).toBeNull();
    });

    it("returns null when the coupon is not valid", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({}, buildCoupon({ valid: false })));
      expect(await find()).toBeNull();
    });

    it("returns null when the coupon is past redeemBy", async () => {
      codeRepository.findAutomatic.mockResolvedValue(
        buildCode({}, buildCoupon({ redeemBy: new Date("2026-10-24T11:59:00Z") })),
      );
      expect(await find()).toBeNull();
    });

    it.each(["active", "trialing", "past_due", "canceled"])(
      "returns null when the customer already has a %s subscription on a recurring non-trial price",
      async (status) => {
        subscriptionRepository.findByStripeCustomerId.mockResolvedValue([
          TRIAL_SUBSCRIPTION,
          { id: "sub_db_2", status, stripePrice: { priceType: "recurring", isTrial: false } },
        ] as any);
        expect(await find()).toBeNull();
      },
    );

    it("ignores a past one-time purchase", async () => {
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([
        { id: "sub_db_3", status: "active", stripePrice: { priceType: "one_time", isTrial: false } },
      ] as any);
      expect((await find())?.id).toBe("code_1");
    });

    it("returns null when the price is below the minimum amount", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({ minimumAmount: 1999, minimumAmountCurrency: "eur" }));
      expect(await find()).toBeNull();
    });

    it("returns null when the minimum amount is in another currency", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({ minimumAmount: 100, minimumAmountCurrency: "usd" }));
      expect(await find()).toBeNull();
    });

    it("returns null when stripeCustomerId is set to another customer", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({ stripeCustomerId: "cus_other" }));
      expect(await find()).toBeNull();
    });

    it("returns the code when stripeCustomerId is this customer", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({ stripeCustomerId: "cus_1" }));
      expect((await find())?.id).toBe("code_1");
    });

    it("returns null when firstTimeTransaction is true", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({ firstTimeTransaction: true }));
      expect(await find()).toBeNull();
    });

    it("returns null for a trial price", async () => {
      priceRepository.findById.mockResolvedValue(buildPrice({ isTrial: true }) as any);
      expect(await find()).toBeNull();
    });

    it("returns null for a one-time price", async () => {
      priceRepository.findById.mockResolvedValue(buildPrice({ priceType: "one_time" }) as any);
      expect(await find()).toBeNull();
    });

    it("returns the code when places are unlimited", async () => {
      codeRepository.findAutomatic.mockResolvedValue(
        buildCode({ maxRedemptions: undefined }, buildCoupon({ maxRedemptions: undefined, timesRedeemed: 900 })),
      );
      expect((await find())?.id).toBe("code_1");
    });

    it("returns the code for any product when the coupon has no product restriction", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({}, buildCoupon({ stripeProductIds: [] })));
      priceRepository.findById.mockResolvedValue(buildPrice({ stripeProduct: { stripeProductId: "prod_pro" } }) as any);
      expect((await find())?.id).toBe("code_1");
    });
  });

  describe("checkAutomaticForPrice", () => {
    const check = (overrides: { stripePromotionCodeId?: string; firstPayment?: boolean } = {}) =>
      service.checkAutomaticForPrice({
        companyId: "company_1",
        priceId: "price_db_1",
        stripePromotionCodeId: "promo_1",
        firstPayment: true,
        ...overrides,
      });

    beforeEach(() => {
      codeRepository.findByStripePromotionCodeId.mockResolvedValue(buildCode());
      couponApi.retrievePromotionCode.mockResolvedValue({
        id: "promo_1",
        active: true,
        max_redemptions: null,
        times_redeemed: 13,
        promotion: { type: "coupon", coupon: { id: "co_1", valid: true, max_redemptions: 50, times_redeemed: 13 } },
      } as unknown as Stripe.PromotionCode);
    });

    it("is eligible when the sent code is the automatic code that applies now", async () => {
      expect(await check()).toBe("eligible");
      expect(codeRepository.findByStripePromotionCodeId).toHaveBeenCalledWith({ stripePromotionCodeId: "promo_1" });
    });

    it("is not_automatic for a code we do not know", async () => {
      codeRepository.findByStripePromotionCodeId.mockResolvedValue(null);
      expect(await check({ stripePromotionCodeId: "promo_typed" })).toBe("not_automatic");
      expect(codeRepository.findAutomatic).not.toHaveBeenCalled();
    });

    it("is not_automatic for one of our codes that is not automatic", async () => {
      codeRepository.findByStripePromotionCodeId.mockResolvedValue(buildCode({ automatic: false }));
      expect(await check()).toBe("not_automatic");
    });

    it("is sold_out when our copy shows no places left (the last place just went)", async () => {
      const soldOut = buildCode({}, buildCoupon({ timesRedeemed: 50 }));
      codeRepository.findByStripePromotionCodeId.mockResolvedValue(soldOut);
      codeRepository.findAutomatic.mockResolvedValue(soldOut);

      expect(await check()).toBe("sold_out");
      expect(couponApi.retrievePromotionCode).not.toHaveBeenCalled();
    });

    it("is sold_out when Stripe says live the places ran out", async () => {
      codeRepository.findAutomatic.mockResolvedValue(null);
      couponApi.retrievePromotionCode.mockResolvedValue({
        id: "promo_1",
        active: true,
        max_redemptions: null,
        times_redeemed: 13,
        promotion: { type: "coupon", coupon: { id: "co_1", valid: true, max_redemptions: 50, times_redeemed: 50 } },
      } as unknown as Stripe.PromotionCode);

      expect(await check()).toBe("sold_out");
    });

    it("is unavailable when the code expired", async () => {
      const expired = buildCode({ expiresAt: new Date("2026-10-23T12:00:00Z") });
      codeRepository.findByStripePromotionCodeId.mockResolvedValue(expired);
      codeRepository.findAutomatic.mockResolvedValue(expired);

      expect(await check()).toBe("unavailable");
    });

    it("is unavailable when it is not a first payment, without checking places", async () => {
      expect(await check({ firstPayment: false })).toBe("unavailable");
      expect(codeRepository.findAutomatic).not.toHaveBeenCalled();
      expect(couponApi.retrievePromotionCode).not.toHaveBeenCalled();
    });

    it("is unavailable when the customer already paid a recurring plan", async () => {
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([
        { id: "sub_db_2", status: "canceled", stripePrice: { priceType: "recurring", isTrial: false } },
      ] as any);
      expect(await check()).toBe("unavailable");
    });

    it("is unavailable when another code is now the automatic one", async () => {
      codeRepository.findAutomatic.mockResolvedValue(buildCode({ id: "code_2", stripePromotionCodeId: "promo_2" }));
      expect(await check()).toBe("unavailable");
    });

    it("is unavailable when the live places read fails and our copy has places", async () => {
      codeRepository.findAutomatic.mockResolvedValue(null);
      couponApi.retrievePromotionCode.mockRejectedValue(new Error("stripe down"));
      vi.spyOn((service as any).logger, "error").mockImplementation(() => undefined);

      expect(await check()).toBe("unavailable");
    });
  });

  describe("findAutomaticForPriceDocument", () => {
    it("builds a list of the one code", async () => {
      await service.findAutomaticForPriceDocument({ companyId: "company_1", priceId: "price_db_1", query: {} });
      const [, data] = jsonApiService.buildList.mock.calls[0];
      expect((data as StripeCouponCode[]).map((c) => c.id)).toEqual(["code_1"]);
    });

    it("builds an empty list when no code applies", async () => {
      codeRepository.findAutomatic.mockResolvedValue(null);
      await service.findAutomaticForPriceDocument({ companyId: "company_1", priceId: "price_db_1", query: {} });
      expect(jsonApiService.buildList.mock.calls[0][1]).toEqual([]);
    });
  });

  describe("isExhausted", () => {
    const livePromotionCode = (
      overrides: Partial<Stripe.PromotionCode> = {},
      coupon: Partial<Stripe.Coupon> = {},
    ): Stripe.PromotionCode =>
      ({
        id: "promo_1",
        active: true,
        max_redemptions: null,
        times_redeemed: 13,
        promotion: {
          type: "coupon",
          coupon: { id: "co_1", valid: true, max_redemptions: 50, times_redeemed: 13, ...coupon },
        },
        ...overrides,
      }) as unknown as Stripe.PromotionCode;

    it("is false when code and coupon have places", async () => {
      couponApi.retrievePromotionCode.mockResolvedValue(livePromotionCode());
      expect(await service.isExhausted("promo_1")).toBe(false);
      expect(couponApi.retrievePromotionCode).toHaveBeenCalledWith("promo_1");
    });

    it("is true when the live promotion code is inactive", async () => {
      couponApi.retrievePromotionCode.mockResolvedValue(livePromotionCode({ active: false }));
      expect(await service.isExhausted("promo_1")).toBe(true);
    });

    it("is true when the promotion code reached its max_redemptions", async () => {
      couponApi.retrievePromotionCode.mockResolvedValue(livePromotionCode({ max_redemptions: 10, times_redeemed: 10 }));
      expect(await service.isExhausted("promo_1")).toBe(true);
    });

    it("is true when the coupon is not valid", async () => {
      couponApi.retrievePromotionCode.mockResolvedValue(livePromotionCode({}, { valid: false }));
      expect(await service.isExhausted("promo_1")).toBe(true);
    });

    it("is true when the coupon reached its max_redemptions", async () => {
      couponApi.retrievePromotionCode.mockResolvedValue(livePromotionCode({}, { times_redeemed: 50 }));
      expect(await service.isExhausted("promo_1")).toBe(true);
    });

    it("retrieves the coupon when it is not expanded", async () => {
      couponApi.retrievePromotionCode.mockResolvedValue(
        livePromotionCode({ promotion: { type: "coupon", coupon: "co_1" } } as any),
      );
      couponApi.retrieveCoupon.mockResolvedValue({
        id: "co_1",
        valid: true,
        max_redemptions: 50,
        times_redeemed: 50,
      } as any);
      expect(await service.isExhausted("promo_1")).toBe(true);
      expect(couponApi.retrieveCoupon).toHaveBeenCalledWith("co_1");
    });
  });

  describe("refreshCountsByStripePromotionCodeId", () => {
    it("patches the code and its coupon counts", async () => {
      codeRepository.findByStripePromotionCodeId.mockResolvedValue(buildCode());
      couponApi.retrievePromotionCode.mockResolvedValue({
        id: "promo_1",
        active: true,
        times_redeemed: 14,
        max_redemptions: null,
        promotion: { type: "coupon", coupon: { id: "co_1", valid: true, times_redeemed: 14, max_redemptions: 50 } },
      } as unknown as Stripe.PromotionCode);

      await service.refreshCountsByStripePromotionCodeId("promo_1");

      expect(codeRepository.findByStripePromotionCodeId).toHaveBeenCalledWith({ stripePromotionCodeId: "promo_1" });
      expect(codeRepository.patch).toHaveBeenCalledWith({ id: "code_1", timesRedeemed: 14, active: true });
      expect(couponRepository.patch).toHaveBeenCalledWith({ id: "coupon_1", timesRedeemed: 14, valid: true });
    });

    it("does nothing when the id is not ours", async () => {
      codeRepository.findByStripePromotionCodeId.mockResolvedValue(null);

      await expect(service.refreshCountsByStripePromotionCodeId("promo_typed")).resolves.toBeUndefined();
      expect(couponApi.retrievePromotionCode).not.toHaveBeenCalled();
      expect(codeRepository.patch).not.toHaveBeenCalled();
      expect(couponRepository.patch).not.toHaveBeenCalled();
    });

    it("does not throw when Stripe fails", async () => {
      codeRepository.findByStripePromotionCodeId.mockResolvedValue(buildCode());
      couponApi.retrievePromotionCode.mockRejectedValue(new Error("stripe down"));
      const logSpy = vi.spyOn((service as any).logger, "error").mockImplementation(() => undefined);

      await expect(service.refreshCountsByStripePromotionCodeId("promo_1")).resolves.toBeUndefined();
      expect(codeRepository.patch).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    });
  });
});
