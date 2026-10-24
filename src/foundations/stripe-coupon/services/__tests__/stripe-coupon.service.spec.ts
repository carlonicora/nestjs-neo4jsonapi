import { BadRequestException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { StripeProductRepository } from "../../../stripe-product/repositories/stripe-product.repository";
import { StripeCouponPostDataDTO } from "../../dtos/stripe-coupon.post.dto";
import { StripeCouponCodeRepository } from "../../repositories/stripe-coupon-code.repository";
import { StripeCouponRepository } from "../../repositories/stripe-coupon.repository";
import { StripeCouponApiService } from "../stripe-coupon-api.service";
import { StripeCouponService } from "../stripe-coupon.service";

const couponData = (attributes: Record<string, unknown> = {}, firstCode: Record<string, unknown> = {}) =>
  ({
    type: "stripe-coupons",
    id: "coupon-1",
    attributes: {
      name: "Founding GM",
      discountType: "percent_off",
      percentOff: 20,
      duration: "forever",
      maxRedemptions: 50,
      productIds: ["p1"],
      firstCode: { code: "FOUNDER", ...firstCode },
      ...attributes,
    },
  }) as unknown as StripeCouponPostDataDTO;

describe("StripeCouponService", () => {
  let service: StripeCouponService;
  let couponRepository: MockedObject<StripeCouponRepository>;
  let codeRepository: MockedObject<StripeCouponCodeRepository>;
  let api: MockedObject<StripeCouponApiService>;
  let productRepository: MockedObject<StripeProductRepository>;
  let jsonApiService: MockedObject<JsonApiService>;

  beforeEach(() => {
    couponRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      patch: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn(),
    } as unknown as MockedObject<StripeCouponRepository>;

    codeRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      patch: vi.fn().mockResolvedValue(undefined),
      setAutomatic: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<StripeCouponCodeRepository>;

    api = {
      createCoupon: vi.fn().mockResolvedValue({ id: "co_1", times_redeemed: 0, valid: true }),
      createPromotionCode: vi
        .fn()
        .mockResolvedValue({ id: "promo_1", code: "FOUNDER", active: true, times_redeemed: 0 }),
      deleteCoupon: vi.fn().mockResolvedValue(undefined),
      renameCoupon: vi.fn().mockResolvedValue({ id: "co_1" }),
      retrieveCoupon: vi.fn(),
      retrievePromotionCode: vi.fn(),
    } as unknown as MockedObject<StripeCouponApiService>;

    productRepository = {
      findById: vi.fn().mockResolvedValue({ id: "p1", stripeProductId: "prod_1" }),
    } as unknown as MockedObject<StripeProductRepository>;

    jsonApiService = {
      buildSingle: vi.fn().mockResolvedValue({ data: { id: "built" } }),
    } as unknown as MockedObject<JsonApiService>;

    const clsService = { get: vi.fn() } as unknown as MockedObject<ClsService>;

    service = new StripeCouponService(
      jsonApiService,
      couponRepository,
      clsService,
      codeRepository,
      api,
      productRepository,
    );
  });

  describe("createWithFirstCode", () => {
    it("creates the Stripe coupon and code, then both nodes, then sets the code automatic", async () => {
      const result = await service.createWithFirstCode({ data: couponData({}, { automatic: true }) });

      expect(productRepository.findById).toHaveBeenCalledWith({ id: "p1" });
      expect(api.createCoupon).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Founding GM",
          percentOff: 20,
          amountOff: undefined,
          duration: "forever",
          maxRedemptions: 50,
          stripeProductIds: ["prod_1"],
        }),
      );
      expect(api.createPromotionCode).toHaveBeenCalledWith(
        expect.objectContaining({ stripeCouponId: "co_1", code: "FOUNDER" }),
      );
      expect(couponRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "coupon-1",
          stripeCouponId: "co_1",
          stripeProductIds: ["prod_1"],
          timesRedeemed: 0,
          valid: true,
        }),
      );

      const codeParams = codeRepository.create.mock.calls[0][0];
      expect(codeParams).toEqual(
        expect.objectContaining({
          stripePromotionCodeId: "promo_1",
          code: "FOUNDER",
          automatic: true,
          coupon: "coupon-1",
        }),
      );
      expect(codeRepository.setAutomatic).toHaveBeenCalledWith({ id: codeParams.id, automatic: true });
      expect(api.createCoupon.mock.invocationCallOrder[0]).toBeLessThan(
        api.createPromotionCode.mock.invocationCallOrder[0],
      );
      expect(result).toEqual({ data: { id: "built" } });
    });

    it("does not set automatic when the first code is not automatic", async () => {
      await service.createWithFirstCode({ data: couponData() });

      expect(codeRepository.create).toHaveBeenCalledWith(expect.objectContaining({ automatic: false }));
      expect(codeRepository.setAutomatic).not.toHaveBeenCalled();
    });

    it("createWithFirstCode deletes the Stripe coupon when the code fails", async () => {
      const failure = new Error("code taken");
      api.createPromotionCode.mockRejectedValue(failure);

      await expect(service.createWithFirstCode({ data: couponData() })).rejects.toBe(failure);

      expect(api.deleteCoupon).toHaveBeenCalledWith("co_1");
      expect(couponRepository.create).not.toHaveBeenCalled();
      expect(codeRepository.create).not.toHaveBeenCalled();
    });

    it("rejects a percentage coupon with amountOff", async () => {
      await expect(service.createWithFirstCode({ data: couponData({ amountOff: 500 }) })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(api.createCoupon).not.toHaveBeenCalled();
    });

    it('rejects "repeating" without durationInMonths', async () => {
      await expect(service.createWithFirstCode({ data: couponData({ duration: "repeating" }) })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(api.createCoupon).not.toHaveBeenCalled();
    });
  });

  describe("rename", () => {
    it("renames in Stripe then patches only the name", async () => {
      couponRepository.findById.mockResolvedValue({ id: "coupon-1", stripeCouponId: "co_1" } as any);

      await service.rename({
        data: { type: "stripe-coupons", id: "coupon-1", attributes: { name: "Founders" } },
      });

      expect(api.renameCoupon).toHaveBeenCalledWith({ stripeCouponId: "co_1", name: "Founders" });
      expect(couponRepository.patch).toHaveBeenCalledWith({ id: "coupon-1", name: "Founders" });
    });
  });

  describe("refreshCounts", () => {
    it("writes the Stripe counts to the coupon and every code", async () => {
      couponRepository.findById.mockResolvedValue({
        id: "coupon-1",
        stripeCouponId: "co_1",
        codes: [
          { id: "code-1", stripePromotionCodeId: "promo_1" },
          { id: "code-2", stripePromotionCodeId: "promo_2" },
        ],
      } as any);
      api.retrieveCoupon.mockResolvedValue({ id: "co_1", times_redeemed: 13, valid: true } as any);
      api.retrievePromotionCode.mockImplementation(
        async (id: string) => ({ id, times_redeemed: id === "promo_1" ? 12 : 1, active: id === "promo_1" }) as any,
      );

      await service.refreshCounts({ id: "coupon-1" });

      expect(api.retrieveCoupon).toHaveBeenCalledWith("co_1");
      expect(couponRepository.patch).toHaveBeenCalledWith({ id: "coupon-1", timesRedeemed: 13, valid: true });
      expect(codeRepository.patch).toHaveBeenCalledWith({ id: "code-1", timesRedeemed: 12, active: true });
      expect(codeRepository.patch).toHaveBeenCalledWith({ id: "code-2", timesRedeemed: 1, active: false });
    });
  });
});
