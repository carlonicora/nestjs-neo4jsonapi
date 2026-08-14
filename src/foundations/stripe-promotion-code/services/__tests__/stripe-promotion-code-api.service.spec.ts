import { Test, TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockStripeClient, MockStripeClient } from "../../../stripe/__tests__/mocks/stripe.mock";
import { MOCK_COUPON } from "../../../stripe/__tests__/fixtures/stripe.fixtures";
import { StripeService } from "../../../stripe/services/stripe.service";
import { StripePromotionCodeApiService } from "../stripe-promotion-code-api.service";

/**
 * Promotion code as returned by API version 2026-07-29.dahlia: the coupon hangs off
 * `promotion`, not off the promotion code itself.
 */
const promotionCode = (overrides: Record<string, unknown> = {}) => ({
  id: "promo_1U4HAeRdR2cvwImTWC9m9drV",
  object: "promotion_code",
  code: "OWNER",
  active: true,
  expires_at: null,
  max_redemptions: null,
  times_redeemed: 0,
  restrictions: { first_time_transaction: false, minimum_amount: null, minimum_amount_currency: null },
  promotion: { type: "coupon", coupon: MOCK_COUPON },
  ...overrides,
});

describe("StripePromotionCodeApiService", () => {
  let service: StripePromotionCodeApiService;
  let mockStripe: MockStripeClient;

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripePromotionCodeApiService,
        {
          provide: StripeService,
          useValue: { getClient: vi.fn().mockReturnValue(mockStripe), isConfigured: vi.fn().mockReturnValue(true) },
        },
      ],
    }).compile();

    service = module.get<StripePromotionCodeApiService>(StripePromotionCodeApiService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validatePromotionCode", () => {
    it("validates a code whose coupon hangs off `promotion`", async () => {
      mockStripe.promotionCodes.list.mockResolvedValue({ data: [promotionCode()] });

      const result = await service.validatePromotionCode({ code: "OWNER" });

      expect(result.data.attributes).toMatchObject({
        valid: true,
        code: "OWNER",
        promotionCodeId: "promo_1U4HAeRdR2cvwImTWC9m9drV",
        discountType: "percent_off",
        discountValue: MOCK_COUPON.percent_off,
        duration: MOCK_COUPON.duration,
        durationInMonths: MOCK_COUPON.duration_in_months,
      });
      expect(result.data.attributes.errorMessage).toBeUndefined();
    });

    it("expands the coupon at its current path", async () => {
      mockStripe.promotionCodes.list.mockResolvedValue({ data: [promotionCode()] });

      await service.validatePromotionCode({ code: "OWNER" });

      // `data.coupon` is silently ignored by the API - it expands nothing and raises no error.
      expect(mockStripe.promotionCodes.list).toHaveBeenCalledWith(
        expect.objectContaining({ expand: ["data.promotion.coupon"] }),
      );
    });

    it("reports an unknown code as invalid", async () => {
      mockStripe.promotionCodes.list.mockResolvedValue({ data: [] });

      const result = await service.validatePromotionCode({ code: "NOPE" });

      expect(result.data.attributes).toMatchObject({ valid: false, errorMessage: "Invalid promotion code" });
    });

    it("reports a code whose coupon could not be resolved", async () => {
      mockStripe.promotionCodes.list.mockResolvedValue({
        data: [promotionCode({ promotion: { type: "coupon", coupon: null } })],
      });

      const result = await service.validatePromotionCode({ code: "OWNER" });

      expect(result.data.attributes).toMatchObject({
        valid: false,
        errorMessage: "Unable to validate promotion code",
      });
    });

    it("rejects a coupon that is no longer valid", async () => {
      mockStripe.promotionCodes.list.mockResolvedValue({
        data: [promotionCode({ promotion: { type: "coupon", coupon: { ...MOCK_COUPON, valid: false } } })],
      });

      const result = await service.validatePromotionCode({ code: "OWNER" });

      expect(result.data.attributes).toMatchObject({
        valid: false,
        errorMessage: "This promotion code is no longer valid",
      });
    });

    it("rejects a code that does not apply to the selected plan", async () => {
      mockStripe.promotionCodes.list.mockResolvedValue({
        data: [
          promotionCode({
            promotion: { type: "coupon", coupon: { ...MOCK_COUPON, applies_to: { products: ["prod_other"] } } },
          }),
        ],
      });
      mockStripe.prices.retrieve.mockResolvedValue({ id: "price_123", product: "prod_selected" });

      const result = await service.validatePromotionCode({ code: "OWNER", stripePriceId: "price_123" });

      expect(result.data.attributes).toMatchObject({
        valid: false,
        errorMessage: "This promotion code does not apply to the selected plan",
      });
    });
  });
});
