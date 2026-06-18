import { describe, it, expect } from "vitest";
import { injectOpenRouterProvider } from "../llm.service";
import { openRouterEscalatingFetch } from "../openrouter-fetch";

describe("openRouterEscalatingFetch", () => {
  it("hard-pins the first attempt, allows fallbacks on retry", async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((_i: any, init: any) => {
      calls.push(init.body);
      return Promise.resolve(new Response("{}"));
    }) as any;
    try {
      const f = openRouterEscalatingFetch("together", false);
      await f("https://x", { body: JSON.stringify({ model: "m" }) } as any);
      await f("https://x", { body: JSON.stringify({ model: "m" }) } as any);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(JSON.parse(calls[0]).provider.allow_fallbacks).toBe(false);
    expect(JSON.parse(calls[1]).provider.allow_fallbacks).toBe(true);
    expect(JSON.parse(calls[0]).provider.order).toEqual(["together"]);
  });
});

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
