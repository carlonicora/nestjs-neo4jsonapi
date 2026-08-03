import { afterEach, describe, expect, it, vi } from "vitest";

import { resetLearnedUnsupportedParams, unsupportedParamFetch } from "../unsupported-param-fetch";

/** A 400 shaped exactly like the one Azure returns for a rejected parameter. */
const rejection = (param: string, code = "unsupported_parameter") =>
  new Response(JSON.stringify({ error: { code, param, message: `'${param}' is not supported with this model.` } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 });

/** Builds a fake fetch that replays `responses` in order and records every body it saw. */
function fakeFetch(responses: Response[]) {
  const bodies: any[] = [];
  const fn = vi.fn(async (_input: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return responses[Math.min(bodies.length - 1, responses.length - 1)];
  });
  return { fn: fn as unknown as typeof fetch, bodies, calls: fn };
}

afterEach(() => {
  resetLearnedUnsupportedParams();
  vi.restoreAllMocks();
});

describe("unsupportedParamFetch", () => {
  it("passes a successful request through untouched", async () => {
    const inner = fakeFetch([ok()]);
    const res = await unsupportedParamFetch("azure|a|m", inner.fn)("u", {
      body: JSON.stringify({ temperature: 0.2, model: "m" }),
    } as any);

    expect(res.status).toBe(200);
    expect(inner.calls).toHaveBeenCalledTimes(1);
    expect(inner.bodies[0]).toEqual({ temperature: 0.2, model: "m" });
  });

  it("drops the parameter the provider names and retries", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = fakeFetch([rejection("temperature", "unsupported_value"), ok()]);

    const res = await unsupportedParamFetch("azure|a|gpt-5-nano", inner.fn)("u", {
      body: JSON.stringify({ temperature: 0.2, model: "gpt-5-nano" }),
    } as any);

    expect(res.status).toBe(200);
    expect(inner.calls).toHaveBeenCalledTimes(2);
    expect(inner.bodies[1]).toEqual({ model: "gpt-5-nano" });
  });

  it("renames max_tokens instead of dropping it, preserving the cap", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = fakeFetch([rejection("max_tokens"), ok()]);

    await unsupportedParamFetch("azure|a|gpt-5-nano", inner.fn)("u", {
      body: JSON.stringify({ max_tokens: 28000, model: "gpt-5-nano" }),
    } as any);

    expect(inner.bodies[1]).toEqual({ max_completion_tokens: 28000, model: "gpt-5-nano" });
  });

  it("repairs several rejected parameters across successive round-trips", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = fakeFetch([rejection("temperature", "unsupported_value"), rejection("frequency_penalty"), ok()]);

    const res = await unsupportedParamFetch("azure|a|gpt-5-nano", inner.fn)("u", {
      body: JSON.stringify({ temperature: 0.2, frequency_penalty: 0.1, model: "gpt-5-nano" }),
    } as any);

    expect(res.status).toBe(200);
    expect(inner.bodies[2]).toEqual({ model: "gpt-5-nano" });
  });

  it("remembers the verdict, so later calls cost no extra round-trip", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fakeFetch([rejection("temperature", "unsupported_value"), ok()]);
    await unsupportedParamFetch("azure|a|gpt-5-nano", first.fn)("u", {
      body: JSON.stringify({ temperature: 0.2, model: "gpt-5-nano" }),
    } as any);

    // A brand-new wrapper — ModelService builds a fresh chat model per call.
    const second = fakeFetch([ok()]);
    const res = await unsupportedParamFetch("azure|a|gpt-5-nano", second.fn)("u", {
      body: JSON.stringify({ temperature: 0.2, model: "gpt-5-nano" }),
    } as any);

    expect(res.status).toBe(200);
    expect(second.calls).toHaveBeenCalledTimes(1);
    expect(second.bodies[0]).toEqual({ model: "gpt-5-nano" });
  });

  it("remembers a parameter-level verdict for EVERY value, not just the one rejected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fakeFetch([rejection("frequency_penalty"), ok()]);
    await unsupportedParamFetch("azure|a|gpt-5-nano", first.fn)("u", {
      body: JSON.stringify({ frequency_penalty: 0.1, model: "gpt-5-nano" }),
    } as any);

    const second = fakeFetch([ok()]);
    await unsupportedParamFetch("azure|a|gpt-5-nano", second.fn)("u", {
      body: JSON.stringify({ frequency_penalty: 0.9, model: "gpt-5-nano" }),
    } as any);

    expect(second.calls).toHaveBeenCalledTimes(1);
    expect(second.bodies[0]).toEqual({ model: "gpt-5-nano" });
  });

  it("scopes an unsupported_value verdict to the value — a different one is still sent", async () => {
    // The reason this distinction exists: `disableThinking: true` maps to
    // `reasoning_effort: "none"`, the newest of the five values and the one a
    // deployment is likeliest to refuse. Remembering that as a parameter-level drop
    // would strip `reasoning_effort` from every later call, silently throwing away
    // the "low" latency win on triage / retrieval / citation audit.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fakeFetch([rejection("reasoning_effort", "unsupported_value"), ok()]);
    await unsupportedParamFetch("azure|a|gpt-5-nano", first.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "none", model: "gpt-5-nano" }),
    } as any);
    expect(first.bodies[1]).toEqual({ model: "gpt-5-nano" });

    const second = fakeFetch([ok()]);
    const res = await unsupportedParamFetch("azure|a|gpt-5-nano", second.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "low", model: "gpt-5-nano" }),
    } as any);

    expect(res.status).toBe(200);
    expect(second.calls).toHaveBeenCalledTimes(1);
    expect(second.bodies[0]).toEqual({ reasoning_effort: "low", model: "gpt-5-nano" });
  });

  it("still short-circuits the SAME rejected value on a later call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fakeFetch([rejection("reasoning_effort", "unsupported_value"), ok()]);
    await unsupportedParamFetch("azure|a|gpt-5-nano", first.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "none", model: "gpt-5-nano" }),
    } as any);

    const second = fakeFetch([ok()]);
    await unsupportedParamFetch("azure|a|gpt-5-nano", second.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "none", model: "gpt-5-nano" }),
    } as any);

    expect(second.calls).toHaveBeenCalledTimes(1);
    expect(second.bodies[0]).toEqual({ model: "gpt-5-nano" });
  });

  it("accumulates several rejected values for one parameter", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fakeFetch([rejection("reasoning_effort", "unsupported_value"), ok()]);
    await unsupportedParamFetch("azure|a|m", first.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "none" }),
    } as any);

    const second = fakeFetch([rejection("reasoning_effort", "unsupported_value"), ok()]);
    await unsupportedParamFetch("azure|a|m", second.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "minimal" }),
    } as any);

    const third = fakeFetch([ok()]);
    await unsupportedParamFetch("azure|a|m", third.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "minimal", extra: 1 }),
    } as any);

    expect(third.calls).toHaveBeenCalledTimes(1);
    expect(third.bodies[0]).toEqual({ extra: 1 });
  });

  it("lets a later parameter-level rejection widen a value-scoped verdict", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fakeFetch([rejection("reasoning_effort", "unsupported_value"), ok()]);
    await unsupportedParamFetch("azure|a|m", first.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "none" }),
    } as any);

    const second = fakeFetch([rejection("reasoning_effort", "unsupported_parameter"), ok()]);
    await unsupportedParamFetch("azure|a|m", second.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "low" }),
    } as any);

    const third = fakeFetch([ok()]);
    await unsupportedParamFetch("azure|a|m", third.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "high", extra: 1 }),
    } as any);

    expect(third.calls).toHaveBeenCalledTimes(1);
    expect(third.bodies[0]).toEqual({ extra: 1 });
  });

  it("renames max_tokens even when the provider reports the VALUE as unsupported", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = fakeFetch([rejection("max_tokens", "unsupported_value"), ok()]);

    await unsupportedParamFetch("azure|a|gpt-5-nano", inner.fn)("u", {
      body: JSON.stringify({ max_tokens: 28000, model: "gpt-5-nano" }),
    } as any);

    expect(inner.bodies[1]).toEqual({ max_completion_tokens: 28000, model: "gpt-5-nano" });
  });

  it("keeps verdicts separate per deployment", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const azure = fakeFetch([rejection("temperature", "unsupported_value"), ok()]);
    await unsupportedParamFetch("azure|a|gpt-5-nano", azure.fn)("u", {
      body: JSON.stringify({ temperature: 0.2 }),
    } as any);

    const other = fakeFetch([ok()]);
    await unsupportedParamFetch("openrouter|r|google/gemini-2.5-flash", other.fn)("u", {
      body: JSON.stringify({ temperature: 0.2 }),
    } as any);

    expect(other.bodies[0]).toEqual({ temperature: 0.2 });
  });

  it("returns an unrelated 400 unchanged, body and status intact", async () => {
    const payload = JSON.stringify({ error: { code: "content_filter", message: "blocked" } });
    const inner = fakeFetch([new Response(payload, { status: 400 })]);

    const res = await unsupportedParamFetch("azure|a|m", inner.fn)("u", {
      body: JSON.stringify({ temperature: 0.2 }),
    } as any);

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(payload);
    expect(inner.calls).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the named parameter was never in the request", async () => {
    const inner = fakeFetch([rejection("logit_bias")]);

    const res = await unsupportedParamFetch("azure|a|m", inner.fn)("u", {
      body: JSON.stringify({ temperature: 0.2 }),
    } as any);

    expect(res.status).toBe(400);
    expect(inner.calls).toHaveBeenCalledTimes(1);
  });

  it("leaves a non-string body alone", async () => {
    const inner = vi.fn(async () => ok());
    await unsupportedParamFetch("azure|a|m", inner as unknown as typeof fetch)("u", { body: undefined } as any);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
