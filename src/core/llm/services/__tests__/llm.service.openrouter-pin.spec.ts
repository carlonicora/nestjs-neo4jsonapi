import { describe, it, expect } from "vitest";
import { injectOpenRouterProvider } from "../llm.service";

describe("injectOpenRouterProvider", () => {
  it("injects the provider routing block into a JSON body", () => {
    const out = injectOpenRouterProvider(JSON.stringify({ model: "m", messages: [] }), "together", false);
    const body = JSON.parse(out);
    expect(body.provider).toEqual({ order: ["together"], allow_fallbacks: false, require_parameters: true });
    expect(body.model).toBe("m"); // existing fields preserved
  });

  it("honours allow_fallbacks=true", () => {
    const body = JSON.parse(injectOpenRouterProvider("{}", "friendli", true));
    expect(body.provider.allow_fallbacks).toBe(true);
    expect(body.provider.order).toEqual(["friendli"]);
  });

  it("returns the body untouched when it is not JSON", () => {
    expect(injectOpenRouterProvider("not-json", "together", false)).toBe("not-json");
  });
});
