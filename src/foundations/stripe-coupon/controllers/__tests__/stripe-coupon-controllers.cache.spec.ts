import { PreconditionFailedException } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StripeCouponCodeController } from "../stripe-coupon-code.controller";
import { StripeCouponController } from "../stripe-coupon.controller";

// @CacheInvalidate and @ValidateId read the route params from the request argument;
// these specs call the handlers with the arguments Nest passes and check both still act.

const reply = () => ({ send: vi.fn(), status: vi.fn().mockReturnThis() }) as any;
const request = (params: Record<string, string>) => ({ params }) as any;

/** Nest passes the request to a handler only when it declares @Req(); without it the decorators see no params. */
const receivesRequest = (controller: object, method: string) =>
  Object.keys(Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}).some((key) =>
    key.startsWith(`${RouteParamtypes.REQUEST}:`),
  );

describe("coupon routes that rely on @CacheInvalidate(meta, id) or @ValidateId", () => {
  it.each([
    [StripeCouponController, "rename"],
    [StripeCouponController, "refreshCounts"],
    [StripeCouponCodeController, "updateFlags"],
  ])("%o.%s receives the request", (controller, method) => {
    expect(receivesRequest(controller, method)).toBe(true);
  });

  it("tells a route without @Req() apart", () => {
    expect(receivesRequest(StripeCouponController, "findAll")).toBe(false);
  });
});

describe("StripeCouponController cache and id checks", () => {
  let cacheService: { invalidateByElement: ReturnType<typeof vi.fn>; invalidateByType: ReturnType<typeof vi.fn> };
  let couponService: { rename: ReturnType<typeof vi.fn>; refreshCounts: ReturnType<typeof vi.fn> };
  let controller: StripeCouponController;

  beforeEach(() => {
    cacheService = { invalidateByElement: vi.fn(), invalidateByType: vi.fn() };
    couponService = {
      rename: vi.fn().mockResolvedValue({ data: {} }),
      refreshCounts: vi.fn().mockResolvedValue({ data: {} }),
    };
    controller = new StripeCouponController(couponService as any, cacheService as any, {} as any);
  });

  it("rename invalidates the coupon's cache entry", async () => {
    const body = { data: { type: "stripe-coupons", id: "co-1", attributes: { name: "Founders" } } } as any;

    await controller.rename(request({ couponId: "co-1" }), reply(), body);

    expect(cacheService.invalidateByElement).toHaveBeenCalledWith("stripe-coupons", "co-1");
  });

  it("rename refuses a body id that differs from the URL id", async () => {
    const body = { data: { type: "stripe-coupons", id: "co-2", attributes: { name: "Founders" } } } as any;

    await expect(controller.rename(request({ couponId: "co-1" }), reply(), body)).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
    expect(couponService.rename).not.toHaveBeenCalled();
  });

  it("refreshCounts invalidates the coupon's cache entry and every code", async () => {
    await controller.refreshCounts(request({ couponId: "co-1" }), reply(), "co-1");

    expect(cacheService.invalidateByElement).toHaveBeenCalledWith("stripe-coupons", "co-1");
    expect(cacheService.invalidateByType).toHaveBeenCalledWith("stripe-coupon-codes");
  });
});

describe("StripeCouponCodeController cache and id checks", () => {
  let cacheService: { invalidateByElement: ReturnType<typeof vi.fn>; invalidateByType: ReturnType<typeof vi.fn> };
  let codeService: { updateFlags: ReturnType<typeof vi.fn>; findCouponId: ReturnType<typeof vi.fn> };
  let controller: StripeCouponCodeController;

  beforeEach(() => {
    cacheService = { invalidateByElement: vi.fn(), invalidateByType: vi.fn() };
    codeService = {
      updateFlags: vi.fn().mockResolvedValue({ data: {} }),
      findCouponId: vi.fn().mockResolvedValue("co-1"),
    };
    controller = new StripeCouponCodeController(codeService as any, cacheService as any, {} as any);
  });

  it("updateFlags with only active invalidates the code's own cache entry", async () => {
    const body = { data: { type: "stripe-coupon-codes", id: "cc-1", attributes: { active: false } } } as any;

    await controller.updateFlags(request({ codeId: "cc-1" }), reply(), "cc-1", body);

    expect(cacheService.invalidateByElement).toHaveBeenCalledWith("stripe-coupon-codes", "cc-1");
    expect(cacheService.invalidateByElement).toHaveBeenCalledWith("stripe-coupons", "co-1");
  });

  it("updateFlags refuses a body id that differs from the URL id", async () => {
    const body = { data: { type: "stripe-coupon-codes", id: "cc-2", attributes: { active: false } } } as any;

    await expect(controller.updateFlags(request({ codeId: "cc-1" }), reply(), "cc-1", body)).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
    expect(codeService.updateFlags).not.toHaveBeenCalled();
  });
});
