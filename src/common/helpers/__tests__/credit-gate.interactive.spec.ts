import { describe, expect, it, vi } from "vitest";
import { pickInteractiveValidator } from "../credit-gate";

describe("pickInteractiveValidator", () => {
  const makeValidator = () => ({ validateCredits: vi.fn() });

  it("returns the interactive validator when bound", () => {
    const interactive = makeValidator();
    const base = makeValidator();
    expect(pickInteractiveValidator(interactive, base)).toBe(interactive);
  });

  it("falls back to the base validator when the interactive one is unbound", () => {
    const base = makeValidator();
    expect(pickInteractiveValidator(undefined, base)).toBe(base);
  });

  it("returns undefined when neither is bound", () => {
    expect(pickInteractiveValidator(undefined, undefined)).toBeUndefined();
  });
});
