import { afterEach, beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import type { ClsService } from "nestjs-cls";
import type { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import type { StripeCoupon } from "../../entities/stripe-coupon";
import type { StripeCouponCode } from "../../entities/stripe-coupon-code";
import { StripeCouponOfferDescriptor } from "../../entities/stripe-coupon-offer";
import type { StripeCouponCodeRepository } from "../../repositories/stripe-coupon-code.repository";
import { StripeCouponOfferService } from "../stripe-coupon-offer.service";

const buildCoupon = (overrides: Partial<StripeCoupon> = {}): StripeCoupon =>
  ({
    id: "coupon_1",
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
    stripePromotionCodeId: "promo_1",
    code: "FOUNDER",
    active: true,
    automatic: true,
    firstTimeTransaction: false,
    timesRedeemed: 13,
    coupon,
    ...overrides,
  }) as StripeCouponCode;

describe("StripeCouponOfferService", () => {
  let service: StripeCouponOfferService;
  let jsonApiService: Mocked<Pick<JsonApiService, "buildList">>;
  let codeRepository: Mocked<Pick<StripeCouponCodeRepository, "findAutomatic">>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    jsonApiService = { buildList: vi.fn().mockResolvedValue({ data: [] }) };
    codeRepository = { findAutomatic: vi.fn().mockResolvedValue(buildCode()) };
    service = new StripeCouponOfferService(
      jsonApiService as unknown as JsonApiService,
      codeRepository as unknown as StripeCouponCodeRepository,
      {} as ClsService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const offers = async () => {
    await service.findPublicOffers({ query: {} });
    const [model, data] = jsonApiService.buildList.mock.calls[0];
    expect(model).toBe(StripeCouponOfferDescriptor.model);
    return data as any[];
  };

  it("builds one offer for the automatic code", async () => {
    expect(await offers()).toEqual([
      {
        id: "code_1",
        discountType: "percent_off",
        percentOff: 20,
        duration: "forever",
        placesLeft: 37,
        placesTotal: 50,
      },
    ]);
  });

  it("uses the code limit when it is smaller", async () => {
    codeRepository.findAutomatic.mockResolvedValue(buildCode({ maxRedemptions: 20, timesRedeemed: 13 }));
    expect(await offers()).toEqual([expect.objectContaining({ placesLeft: 7, placesTotal: 20 })]);
  });

  it("is empty when there is no automatic code", async () => {
    codeRepository.findAutomatic.mockResolvedValue(null);
    expect(await offers()).toEqual([]);
  });

  it("is empty when places are unlimited", async () => {
    codeRepository.findAutomatic.mockResolvedValue(buildCode({}, buildCoupon({ maxRedemptions: undefined })));
    expect(await offers()).toEqual([]);
  });

  it("is empty when places left is 0", async () => {
    codeRepository.findAutomatic.mockResolvedValue(buildCode({}, buildCoupon({ timesRedeemed: 50 })));
    expect(await offers()).toEqual([]);
  });

  it("is empty when the code is expired", async () => {
    codeRepository.findAutomatic.mockResolvedValue(buildCode({ expiresAt: new Date("2026-10-23T00:00:00Z") }));
    expect(await offers()).toEqual([]);
  });

  it("is empty when the coupon is invalid or past redeemBy", async () => {
    codeRepository.findAutomatic.mockResolvedValue(buildCode({}, buildCoupon({ valid: false })));
    expect(await offers()).toEqual([]);

    jsonApiService.buildList.mockClear();
    codeRepository.findAutomatic.mockResolvedValue(
      buildCode({}, buildCoupon({ redeemBy: new Date("2026-10-24T00:00:00Z") })),
    );
    expect(await offers()).toEqual([]);
  });
});
