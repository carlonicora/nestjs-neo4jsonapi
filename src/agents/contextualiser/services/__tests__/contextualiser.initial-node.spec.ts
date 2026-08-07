import { describe, expect, it } from "vitest";
import { selectInitialNode } from "../contextualiser.service";

describe("selectInitialNode", () => {
  it("starts a fresh conversation at rational_plan (nothing to refine)", () => {
    expect(selectInitialNode(0)).toBe("rational_plan");
  });

  it("routes follow-up turns through question_refiner", () => {
    expect(selectInitialNode(3)).toBe("question_refiner");
  });
});
