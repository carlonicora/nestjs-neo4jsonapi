import { describe, expect, it } from "vitest";
import { placesLeft, placesTotal } from "../places-left";

describe("placesLeft / placesTotal", () => {
  it("returns null when neither limit is set", () =>
    expect(placesLeft({ timesRedeemed: 3 }, { timesRedeemed: 3 })).toBeNull());
  it("uses the coupon limit alone", () =>
    expect(placesLeft({ timesRedeemed: 0 }, { maxRedemptions: 50, timesRedeemed: 13 })).toBe(37));
  it("uses the code limit alone", () =>
    expect(placesLeft({ maxRedemptions: 10, timesRedeemed: 4 }, { timesRedeemed: 40 })).toBe(6));
  it("takes the smaller of coupon and code", () =>
    expect(placesLeft({ maxRedemptions: 10, timesRedeemed: 8 }, { maxRedemptions: 50, timesRedeemed: 13 })).toBe(2));
  it("never goes below zero", () =>
    expect(placesLeft({ timesRedeemed: 0 }, { maxRedemptions: 50, timesRedeemed: 51 })).toBe(0));
  it("placesTotal is the smaller set limit", () =>
    expect(placesTotal({ maxRedemptions: 10, timesRedeemed: 0 }, { maxRedemptions: 50, timesRedeemed: 0 })).toBe(10));
  it("placesTotal is null when neither limit is set", () =>
    expect(placesTotal({ timesRedeemed: 0 }, { timesRedeemed: 0 })).toBeNull());
});
