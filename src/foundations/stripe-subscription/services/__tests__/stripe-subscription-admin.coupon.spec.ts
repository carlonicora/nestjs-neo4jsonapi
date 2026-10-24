import { afterEach, beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { JsonApiService } from "../../../../core/jsonapi";
import type { StripeCouponCodeCheckoutService } from "../../../stripe-coupon/services/stripe-coupon-code-checkout.service";
import type { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
import type { StripeCustomerApiService } from "../../../stripe-customer/services/stripe-customer-api.service";
import type { StripePriceRepository } from "../../../stripe-price/repositories/stripe-price.repository";
import { StripeError } from "../../../stripe/errors/stripe.errors";
import type { StripePaymentService } from "../../../stripe/services/stripe.payment.service";
import type { StripeSubscriptionRepository } from "../../repositories/stripe-subscription.repository";
import { StripeSubscriptionAdminService } from "../stripe-subscription-admin.service";
import type { StripeSubscriptionApiService } from "../stripe-subscription-api.service";

const CUSTOMER = { id: "customer_db_1", stripeCustomerId: "cus_1" };
const PRICE = { id: "price_db_std", stripePriceId: "price_std", priceType: "recurring", isTrial: false };
const AUTOMATIC_CODE = { id: "code_1", stripePromotionCodeId: "promo_auto" };

const STRIPE_SUBSCRIPTION = {
  id: "sub_1",
  status: "active",
  cancel_at_period_end: false,
  trial_start: null,
  trial_end: null,
  latest_invoice: null,
  items: { data: [{ id: "si_1", current_period_start: 1798761600, current_period_end: 1801440000 }] },
};

const dbSubscription = (status: string) => ({
  id: "sub_db_1",
  stripeSubscriptionId: "sub_1",
  status,
  stripeCustomer: { id: CUSTOMER.id },
  stripePrice: { priceType: "recurring", isTrial: status === "trialing" },
});

describe("StripeSubscriptionAdminService coupon integration", () => {
  let service: StripeSubscriptionAdminService;
  let subscriptionRepository: Mocked<
    Pick<StripeSubscriptionRepository, "findById" | "findByStripeCustomerId" | "create" | "update" | "updatePrice">
  >;
  let customerRepository: Mocked<Pick<StripeCustomerRepository, "findByCompanyId">>;
  let priceRepository: Mocked<Pick<StripePriceRepository, "findById">>;
  let subscriptionApi: Mocked<Pick<StripeSubscriptionApiService, "createSubscription" | "updateSubscription">>;
  let customerApi: Mocked<Pick<StripeCustomerApiService, "listPaymentMethods">>;
  let jsonApiService: Mocked<Pick<JsonApiService, "buildSingle">>;
  let checkout: Mocked<
    Pick<
      StripeCouponCodeCheckoutService,
      "findAutomaticForPrice" | "checkAutomaticForPrice" | "isExhausted" | "refreshCountsByStripePromotionCodeId"
    >
  >;

  beforeEach(() => {
    subscriptionRepository = {
      findById: vi.fn(),
      findByStripeCustomerId: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "sub_db_new" }),
      update: vi.fn().mockResolvedValue({ id: "sub_db_1" }),
      updatePrice: vi.fn().mockResolvedValue(undefined),
    };
    customerRepository = { findByCompanyId: vi.fn().mockResolvedValue(CUSTOMER) };
    priceRepository = { findById: vi.fn().mockResolvedValue(PRICE) };
    subscriptionApi = {
      createSubscription: vi.fn().mockResolvedValue(STRIPE_SUBSCRIPTION),
      updateSubscription: vi.fn().mockResolvedValue(STRIPE_SUBSCRIPTION),
    };
    customerApi = { listPaymentMethods: vi.fn().mockResolvedValue([{ id: "pm_1" }]) };
    jsonApiService = { buildSingle: vi.fn().mockResolvedValue({ data: { id: "sub_db_1" } }) };
    checkout = {
      findAutomaticForPrice: vi.fn().mockResolvedValue(AUTOMATIC_CODE),
      checkAutomaticForPrice: vi.fn().mockResolvedValue("not_automatic"),
      isExhausted: vi.fn().mockResolvedValue(false),
      refreshCountsByStripePromotionCodeId: vi.fn().mockResolvedValue(undefined),
    };

    service = new StripeSubscriptionAdminService(
      subscriptionRepository as unknown as StripeSubscriptionRepository,
      customerRepository as unknown as StripeCustomerRepository,
      priceRepository as unknown as StripePriceRepository,
      subscriptionApi as unknown as StripeSubscriptionApiService,
      customerApi as unknown as StripeCustomerApiService,
      {} as StripePaymentService,
      jsonApiService as unknown as JsonApiService,
      checkout as unknown as StripeCouponCodeCheckoutService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createSubscription", () => {
    it("attaches the automatic code on a first payment and refreshes the counts after success", async () => {
      await service.createSubscription({ companyId: "company_1", priceId: "price_db_std" });

      expect(checkout.findAutomaticForPrice).toHaveBeenCalledWith({ companyId: "company_1", priceId: "price_db_std" });
      expect(subscriptionApi.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: "promo_auto" }),
      );
      expect(checkout.refreshCountsByStripePromotionCodeId).toHaveBeenCalledWith("promo_auto");
      expect(subscriptionApi.createSubscription.mock.invocationCallOrder[0]).toBeLessThan(
        checkout.refreshCountsByStripePromotionCodeId.mock.invocationCallOrder[0],
      );
    });

    it("sends no code when no automatic code applies", async () => {
      checkout.findAutomaticForPrice.mockResolvedValue(null);

      await service.createSubscription({ companyId: "company_1", priceId: "price_db_std" });

      expect(subscriptionApi.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: undefined }),
      );
      expect(checkout.refreshCountsByStripePromotionCodeId).not.toHaveBeenCalled();
    });

    it("never looks up the automatic code when starting a trial", async () => {
      await service.createSubscription({ companyId: "company_1", priceId: "price_db_std", trialPeriodDays: 14 });

      expect(checkout.findAutomaticForPrice).not.toHaveBeenCalled();
      expect(subscriptionApi.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: undefined, trialPeriodDays: 14 }),
      );
    });

    it("passes a typed promotion code unchanged", async () => {
      await service.createSubscription({
        companyId: "company_1",
        priceId: "price_db_std",
        promotionCode: "promo_typed",
      });

      expect(checkout.findAutomaticForPrice).not.toHaveBeenCalled();
      expect(subscriptionApi.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: "promo_typed" }),
      );
      expect(checkout.refreshCountsByStripePromotionCodeId).toHaveBeenCalledWith("promo_typed");
    });

    it("maps a Stripe rejection on an exhausted code to 410", async () => {
      subscriptionApi.createSubscription.mockRejectedValue(
        new StripeError("This promotion code cannot be redeemed", HttpStatus.BAD_REQUEST, "promotion_code_invalid"),
      );
      checkout.isExhausted.mockResolvedValue(true);

      const error = await service
        .createSubscription({ companyId: "company_1", priceId: "price_db_std" })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect(error).not.toBeInstanceOf(StripeError);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.GONE);
      expect((error as HttpException).getResponse()).toEqual(expect.objectContaining({ code: "discount_sold_out" }));
      expect(checkout.isExhausted).toHaveBeenCalledWith("promo_auto");
      expect(subscriptionRepository.create).not.toHaveBeenCalled();
      expect(checkout.refreshCountsByStripePromotionCodeId).not.toHaveBeenCalled();
    });

    it("re-throws the original StripeError when the code is not exhausted", async () => {
      const stripeError = new StripeError("Your card was declined", HttpStatus.BAD_REQUEST, "card_declined");
      subscriptionApi.createSubscription.mockRejectedValue(stripeError);
      checkout.isExhausted.mockResolvedValue(false);

      await expect(service.createSubscription({ companyId: "company_1", priceId: "price_db_std" })).rejects.toBe(
        stripeError,
      );
    });

    it("re-throws the original StripeError when the live check itself fails", async () => {
      const stripeError = new StripeError("Bad request", HttpStatus.BAD_REQUEST, "x");
      subscriptionApi.createSubscription.mockRejectedValue(stripeError);
      checkout.isExhausted.mockRejectedValue(new Error("stripe down"));

      await expect(service.createSubscription({ companyId: "company_1", priceId: "price_db_std" })).rejects.toBe(
        stripeError,
      );
    });
    it("checks a sent code against the automatic code as a first payment", async () => {
      await service.createSubscription({
        companyId: "company_1",
        priceId: "price_db_std",
        promotionCode: "promo_typed",
      });

      expect(checkout.checkAutomaticForPrice).toHaveBeenCalledWith({
        companyId: "company_1",
        priceId: "price_db_std",
        stripePromotionCodeId: "promo_typed",
        firstPayment: true,
      });
    });

    it("passes a sent eligible automatic code to Stripe", async () => {
      checkout.checkAutomaticForPrice.mockResolvedValue("eligible");

      await service.createSubscription({
        companyId: "company_1",
        priceId: "price_db_std",
        promotionCode: "promo_auto",
      });

      expect(checkout.findAutomaticForPrice).not.toHaveBeenCalled();
      expect(subscriptionApi.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: "promo_auto" }),
      );
      expect(checkout.refreshCountsByStripePromotionCodeId).toHaveBeenCalledWith("promo_auto");
    });

    it("answers 410 and never calls Stripe when the sent automatic code lost its last place", async () => {
      checkout.checkAutomaticForPrice.mockResolvedValue("sold_out");

      const error = await service
        .createSubscription({ companyId: "company_1", priceId: "price_db_std", promotionCode: "promo_auto" })
        .catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(HttpStatus.GONE);
      expect((error as HttpException).getResponse()).toEqual({
        message: "The discount has no places left",
        code: "discount_sold_out",
      });
      expect(subscriptionApi.createSubscription).not.toHaveBeenCalled();
      expect(subscriptionRepository.create).not.toHaveBeenCalled();
    });

    it("answers 422 and never calls Stripe when the sent automatic code no longer applies", async () => {
      checkout.checkAutomaticForPrice.mockResolvedValue("unavailable");

      const error = await service
        .createSubscription({ companyId: "company_1", priceId: "price_db_std", promotionCode: "promo_auto" })
        .catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect((error as HttpException).getResponse()).toEqual({
        message: "The discount is no longer available",
        code: "discount_unavailable",
      });
      expect(subscriptionApi.createSubscription).not.toHaveBeenCalled();
    });

    it("re-throws the original StripeError when Stripe rejects a typed code as used up", async () => {
      const stripeError = new StripeError(
        "This promotion code cannot be redeemed",
        HttpStatus.BAD_REQUEST,
        "promotion_code_invalid",
      );
      subscriptionApi.createSubscription.mockRejectedValue(stripeError);
      checkout.isExhausted.mockResolvedValue(true);

      await expect(
        service.createSubscription({ companyId: "company_1", priceId: "price_db_std", promotionCode: "promo_typed" }),
      ).rejects.toBe(stripeError);
      expect(checkout.isExhausted).not.toHaveBeenCalled();
    });

    it("maps a Stripe rejection on a sent eligible automatic code to 410", async () => {
      checkout.checkAutomaticForPrice.mockResolvedValue("eligible");
      subscriptionApi.createSubscription.mockRejectedValue(
        new StripeError("This promotion code cannot be redeemed", HttpStatus.BAD_REQUEST, "promotion_code_invalid"),
      );
      checkout.isExhausted.mockResolvedValue(true);

      const error = await service
        .createSubscription({ companyId: "company_1", priceId: "price_db_std", promotionCode: "promo_auto" })
        .catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(HttpStatus.GONE);
      expect(checkout.isExhausted).toHaveBeenCalledWith("promo_auto");
    });
  });

  describe("changePlan", () => {
    it("attaches the automatic code on a trialing subscription", async () => {
      subscriptionRepository.findById.mockResolvedValue(dbSubscription("trialing") as any);

      await service.changePlan({ id: "sub_db_1", companyId: "company_1", newPriceId: "price_db_std" });

      expect(checkout.findAutomaticForPrice).toHaveBeenCalledWith({ companyId: "company_1", priceId: "price_db_std" });
      expect(subscriptionApi.updateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: "promo_auto", trialEnd: "now", prorationBehavior: "none" }),
      );
      expect(checkout.refreshCountsByStripePromotionCodeId).toHaveBeenCalledWith("promo_auto");
    });

    it("changePlan on active subscription sends no promotionCode", async () => {
      subscriptionRepository.findById.mockResolvedValue(dbSubscription("active") as any);

      await service.changePlan({ id: "sub_db_1", companyId: "company_1", newPriceId: "price_db_std" });

      expect(checkout.findAutomaticForPrice).not.toHaveBeenCalled();
      expect(subscriptionApi.updateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: undefined, prorationBehavior: "create_prorations" }),
      );
      expect(checkout.refreshCountsByStripePromotionCodeId).not.toHaveBeenCalled();
    });

    it("passes a typed code on a trialing subscription without the automatic lookup", async () => {
      subscriptionRepository.findById.mockResolvedValue(dbSubscription("trialing") as any);

      await service.changePlan({
        id: "sub_db_1",
        companyId: "company_1",
        newPriceId: "price_db_std",
        promotionCode: "promo_typed",
      });

      expect(checkout.findAutomaticForPrice).not.toHaveBeenCalled();
      expect(subscriptionApi.updateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: "promo_typed" }),
      );
    });

    it("maps a Stripe rejection on an exhausted code to 410", async () => {
      subscriptionRepository.findById.mockResolvedValue(dbSubscription("trialing") as any);
      subscriptionApi.updateSubscription.mockRejectedValue(
        new StripeError("This promotion code cannot be redeemed", HttpStatus.BAD_REQUEST, "promotion_code_invalid"),
      );
      checkout.isExhausted.mockResolvedValue(true);

      const error = await service
        .changePlan({ id: "sub_db_1", companyId: "company_1", newPriceId: "price_db_std" })
        .catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(HttpStatus.GONE);
      expect((error as HttpException).getResponse()).toEqual(expect.objectContaining({ code: "discount_sold_out" }));
      expect(subscriptionRepository.updatePrice).not.toHaveBeenCalled();
    });

    it("answers 410 and never calls Stripe when the sent automatic code lost its last place on a trial", async () => {
      subscriptionRepository.findById.mockResolvedValue(dbSubscription("trialing") as any);
      checkout.checkAutomaticForPrice.mockResolvedValue("sold_out");

      const error = await service
        .changePlan({ id: "sub_db_1", companyId: "company_1", newPriceId: "price_db_std", promotionCode: "promo_auto" })
        .catch((e: unknown) => e);

      expect(checkout.checkAutomaticForPrice).toHaveBeenCalledWith({
        companyId: "company_1",
        priceId: "price_db_std",
        stripePromotionCodeId: "promo_auto",
        firstPayment: true,
      });
      expect((error as HttpException).getStatus()).toBe(HttpStatus.GONE);
      expect((error as HttpException).getResponse()).toEqual(expect.objectContaining({ code: "discount_sold_out" }));
      expect(subscriptionApi.updateSubscription).not.toHaveBeenCalled();
      expect(subscriptionRepository.updatePrice).not.toHaveBeenCalled();
    });

    it("answers 422 and never calls Stripe for a sent automatic code on a paid plan change", async () => {
      subscriptionRepository.findById.mockResolvedValue(dbSubscription("active") as any);
      checkout.checkAutomaticForPrice.mockResolvedValue("unavailable");

      const error = await service
        .changePlan({ id: "sub_db_1", companyId: "company_1", newPriceId: "price_db_std", promotionCode: "promo_auto" })
        .catch((e: unknown) => e);

      expect(checkout.checkAutomaticForPrice).toHaveBeenCalledWith(expect.objectContaining({ firstPayment: false }));
      expect((error as HttpException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect((error as HttpException).getResponse()).toEqual(expect.objectContaining({ code: "discount_unavailable" }));
      expect(subscriptionApi.updateSubscription).not.toHaveBeenCalled();
    });

    it("passes a sent eligible automatic code to Stripe on a trial", async () => {
      subscriptionRepository.findById.mockResolvedValue(dbSubscription("trialing") as any);
      checkout.checkAutomaticForPrice.mockResolvedValue("eligible");

      await service.changePlan({
        id: "sub_db_1",
        companyId: "company_1",
        newPriceId: "price_db_std",
        promotionCode: "promo_auto",
      });

      expect(checkout.findAutomaticForPrice).not.toHaveBeenCalled();
      expect(subscriptionApi.updateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ promotionCode: "promo_auto", trialEnd: "now" }),
      );
      expect(checkout.refreshCountsByStripePromotionCodeId).toHaveBeenCalledWith("promo_auto");
    });

    it("re-throws the original StripeError when Stripe rejects a typed code as used up", async () => {
      subscriptionRepository.findById.mockResolvedValue(dbSubscription("trialing") as any);
      const stripeError = new StripeError(
        "This promotion code cannot be redeemed",
        HttpStatus.BAD_REQUEST,
        "promotion_code_invalid",
      );
      subscriptionApi.updateSubscription.mockRejectedValue(stripeError);
      checkout.isExhausted.mockResolvedValue(true);

      await expect(
        service.changePlan({
          id: "sub_db_1",
          companyId: "company_1",
          newPriceId: "price_db_std",
          promotionCode: "promo_typed",
        }),
      ).rejects.toBe(stripeError);
      expect(checkout.isExhausted).not.toHaveBeenCalled();
    });
  });
});
