import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedObject } from "vitest";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { StripeCouponCodePostDataDTO } from "../../dtos/stripe-coupon-code.post.dto";
import { StripeCouponCodeRepository } from "../../repositories/stripe-coupon-code.repository";
import { StripeCouponRepository } from "../../repositories/stripe-coupon.repository";
import { StripeCouponApiService } from "../stripe-coupon-api.service";
import { StripeCouponCodeService } from "../stripe-coupon-code.service";

describe("StripeCouponCodeService", () => {
  let service: StripeCouponCodeService;
  let codeRepository: MockedObject<StripeCouponCodeRepository>;
  let couponRepository: MockedObject<StripeCouponRepository>;
  let api: MockedObject<StripeCouponApiService>;
  let jsonApiService: MockedObject<JsonApiService>;

  beforeEach(() => {
    codeRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      patch: vi.fn().mockResolvedValue(undefined),
      setAutomatic: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue({
        id: "code-1",
        stripePromotionCodeId: "promo_1",
        active: true,
        automatic: false,
        coupon: { id: "coupon-1" },
      }),
    } as unknown as MockedObject<StripeCouponCodeRepository>;

    couponRepository = {
      findById: vi.fn().mockResolvedValue({ id: "coupon-1", stripeCouponId: "co_1" }),
    } as unknown as MockedObject<StripeCouponRepository>;

    api = {
      createPromotionCode: vi
        .fn()
        .mockResolvedValue({ id: "promo_2", code: "FRIEND", active: true, times_redeemed: 0 }),
      setPromotionCodeActive: vi.fn().mockResolvedValue({ id: "promo_1", active: false }),
    } as unknown as MockedObject<StripeCouponApiService>;

    jsonApiService = {
      buildSingle: vi.fn().mockResolvedValue({ data: { id: "built" } }),
    } as unknown as MockedObject<JsonApiService>;

    const clsService = { get: vi.fn() } as unknown as MockedObject<ClsService>;

    service = new StripeCouponCodeService(jsonApiService, codeRepository, clsService, couponRepository, api);
  });

  describe("createForCoupon", () => {
    const data = (attributes: Record<string, unknown>) =>
      ({
        type: "stripe-coupon-codes",
        id: "code-2",
        attributes,
        relationships: { coupon: { data: { type: "stripe-coupons", id: "coupon-1" } } },
      }) as unknown as StripeCouponCodePostDataDTO;

    it("creates the Stripe code on the coupon, the linked node, and sets it automatic", async () => {
      await service.createForCoupon({ data: data({ code: "FRIEND", maxRedemptions: 5, automatic: true }) });

      expect(couponRepository.findById).toHaveBeenCalledWith({ id: "coupon-1" });
      expect(api.createPromotionCode).toHaveBeenCalledWith(
        expect.objectContaining({ stripeCouponId: "co_1", code: "FRIEND", maxRedemptions: 5 }),
      );
      expect(codeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "code-2",
          stripePromotionCodeId: "promo_2",
          code: "FRIEND",
          automatic: true,
          coupon: "coupon-1",
        }),
      );
      expect(codeRepository.setAutomatic).toHaveBeenCalledWith({ id: "code-2", automatic: true });
    });

    it("does not set automatic when not asked", async () => {
      await service.createForCoupon({ data: data({ code: "FRIEND" }) });

      expect(codeRepository.setAutomatic).not.toHaveBeenCalled();
    });
  });

  describe("updateFlags", () => {
    it("patch automatic=true calls setAutomatic", async () => {
      await service.updateFlags({
        data: { type: "stripe-coupon-codes", id: "code-1", attributes: { automatic: true } },
      });

      expect(codeRepository.setAutomatic).toHaveBeenCalledWith({ id: "code-1", automatic: true });
      expect(api.setPromotionCodeActive).not.toHaveBeenCalled();
      expect(api.createPromotionCode).not.toHaveBeenCalled();
    });

    it("patch active=false calls setPromotionCodeActive", async () => {
      await service.updateFlags({ data: { type: "stripe-coupon-codes", id: "code-1", attributes: { active: false } } });

      expect(api.setPromotionCodeActive).toHaveBeenCalledWith({ stripePromotionCodeId: "promo_1", active: false });
      expect(codeRepository.patch).toHaveBeenCalledWith({ id: "code-1", active: false });
      expect(api.setPromotionCodeActive.mock.invocationCallOrder[0]).toBeLessThan(
        codeRepository.patch.mock.invocationCallOrder[0],
      );
      expect(codeRepository.setAutomatic).not.toHaveBeenCalled();
    });
  });
});
