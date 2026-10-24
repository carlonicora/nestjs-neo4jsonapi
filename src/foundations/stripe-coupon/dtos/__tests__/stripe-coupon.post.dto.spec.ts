import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { stripeCouponMeta } from "../../entities/stripe-coupon.meta";
import { StripeCouponPostDTO } from "../stripe-coupon.post.dto";

const body = (attributes: Record<string, unknown>) =>
  plainToInstance(StripeCouponPostDTO, {
    data: {
      type: stripeCouponMeta.endpoint,
      id: "6f1c1f3e-8a5b-4c3d-9e2f-1a2b3c4d5e6f",
      attributes: {
        name: "Founding GM",
        discountType: "percent_off",
        percentOff: 20,
        duration: "forever",
        maxRedemptions: 50,
        ...attributes,
      },
    },
  });

describe("StripeCouponPostDTO", () => {
  it("accepts a valid percentage body with a first code", async () => {
    const errors = await validate(body({ firstCode: { code: "FOUNDER" } }));

    expect(errors).toHaveLength(0);
  });

  it("rejects a redeemBy that is not a date string", async () => {
    const errors = await validate(body({ firstCode: { code: "FOUNDER" }, redeemBy: "tomorrow" }));

    expect(JSON.stringify(errors)).toContain("redeemBy");
  });

  it("rejects a body without firstCode", async () => {
    const errors = await validate(body({}));

    expect(JSON.stringify(errors)).toContain("firstCode");
  });
});
