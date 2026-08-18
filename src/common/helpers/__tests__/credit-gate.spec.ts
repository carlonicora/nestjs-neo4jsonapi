import { describe, expect, it, vi } from "vitest";
import { isAiEnabledVia } from "../credit-gate";

describe("isAiEnabledVia", () => {
  it("returns true when no validator is bound", async () => {
    await expect(isAiEnabledVia(undefined, { companyId: "c1" })).resolves.toBe(true);
  });

  it("returns true when the validator does not implement isAiEnabled", async () => {
    const validator = { validateCredits: vi.fn() };
    await expect(isAiEnabledVia(validator, { companyId: "c1" })).resolves.toBe(true);
  });

  it("returns the validator's answer when implemented", async () => {
    const validator = { validateCredits: vi.fn(), isAiEnabled: vi.fn().mockResolvedValue(false) };
    await expect(isAiEnabledVia(validator, { companyId: "c1" })).resolves.toBe(false);
  });

  it("returns true when the validator throws", async () => {
    const validator = { validateCredits: vi.fn(), isAiEnabled: vi.fn().mockRejectedValue(new Error("db down")) };
    await expect(isAiEnabledVia(validator, { companyId: "c1" })).resolves.toBe(true);
  });
});
