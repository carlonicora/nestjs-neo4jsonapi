import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { parseJsonApiSort } from "../../../core/neo4j/helpers/parse-jsonapi-sort";
import { StripeCouponCodeController } from "../controllers/stripe-coupon-code.controller";
import { StripeCouponController } from "../controllers/stripe-coupon.controller";
import { StripeCouponDescriptor } from "../entities/stripe-coupon";
import { StripeCouponCodeDescriptor } from "../entities/stripe-coupon-code";

/** Column sorting on the coupons (spec row A20) and coupon codes (spec row A21) lists. */

const reply = { send: vi.fn() } as any;

describe("Stripe coupon controllers sort", () => {
  it("StripeCouponController.findAll forwards sort and the legacy orderBy (call C10)", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new StripeCouponController(service as any, {} as any, {} as any);
    await controller.findAll(reply, {}, undefined, undefined, "name", "-timesRedeemed");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-timesRedeemed", orderBy: "name" }));
  });

  it("StripeCouponCodeController.findByCoupon forwards sort beside its fixed createdAt order", async () => {
    const service = { findByRelated: vi.fn().mockResolvedValue({}) };
    const controller = new StripeCouponCodeController(service as any, {} as any, {} as any);
    await controller.findByCoupon(reply, "coupon-1", {}, undefined, undefined, "-expiresAt");
    expect(service.findByRelated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "coupon-1", sort: "-expiresAt", orderBy: "createdAt" }),
    );
  });
});

describe("Stripe coupon descriptors sortable fields", () => {
  it("coupon accepts its stored columns", () => {
    expect(
      parseJsonApiSort({
        sort: "name,valid,timesRedeemed,maxRedemptions,discountType",
        descriptor: StripeCouponDescriptor,
      }),
    ).toHaveLength(5);
    expect(parseJsonApiSort({ sort: "percentOff,-amountOff", descriptor: StripeCouponDescriptor })).toHaveLength(2);
  });

  it("coupon code accepts its stored columns", () => {
    expect(
      parseJsonApiSort({ sort: "code,-expiresAt,automatic,timesRedeemed", descriptor: StripeCouponCodeDescriptor }),
    ).toHaveLength(4);
  });

  it.each([
    [StripeCouponDescriptor, "stripeCouponId"],
    [StripeCouponDescriptor, "codes"],
    [StripeCouponCodeDescriptor, "stripePromotionCodeId"],
    [StripeCouponCodeDescriptor, "status"],
  ])("refuses an unsortable field with a 400 (%#)", (descriptor, field) => {
    expect(() => parseJsonApiSort({ sort: field, descriptor: descriptor as any })).toThrow(BadRequestException);
  });
});
