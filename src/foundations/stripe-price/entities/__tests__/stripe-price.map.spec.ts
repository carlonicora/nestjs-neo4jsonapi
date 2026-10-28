import { describe, expect, it } from "vitest";
import { mapStripePrice } from "../stripe-price.map";

const map = (data: Record<string, unknown>) => mapStripePrice({ data, record: {}, entityFactory: {} as any });

describe("mapStripePrice token", () => {
  it("keeps a 0 allowance as 0", () => {
    expect(map({ id: "p1", token: 0 }).token).toBe(0);
  });

  it("reads a numeric allowance", () => {
    expect(map({ id: "p1", token: 500 }).token).toBe(500);
  });

  it("leaves a missing allowance undefined", () => {
    expect(map({ id: "p1" }).token).toBeUndefined();
    expect(map({ id: "p1", token: null }).token).toBeUndefined();
  });
});
