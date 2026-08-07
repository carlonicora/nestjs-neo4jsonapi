import { describe, expect, it } from "vitest";
import { resolveAllowedBranches } from "../responder.service";

describe("resolveAllowedBranches", () => {
  it("defaults everything on", () => {
    expect(resolveAllowedBranches(undefined, undefined)).toEqual({ graph: true, contextualiser: true, drift: true });
  });
  it("config can switch a branch off", () => {
    expect(resolveAllowedBranches({ drift: false }, undefined).drift).toBe(false);
  });
  it("per-call AND config compose (either off wins)", () => {
    expect(resolveAllowedBranches({ drift: false }, { graph: false })).toEqual({
      graph: false,
      contextualiser: true,
      drift: false,
    });
  });
});
