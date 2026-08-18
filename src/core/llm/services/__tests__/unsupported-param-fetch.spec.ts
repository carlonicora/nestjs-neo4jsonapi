import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetLearnedUnsupportedParams, unsupportedParamFetch } from "../unsupported-param-fetch";

/** A 400 shaped exactly like the one Azure returns for a rejected parameter. */
const rejection = (param: string, code = "unsupported_parameter") =>
  new Response(JSON.stringify({ error: { code, param, message: `'${param}' is not supported with this model.` } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 });

/**
 * The 400 Azure returns for gpt-5.6-luna when a request carries BOTH function
 * tools and `reasoning_effort` — captured verbatim on 2026-08-17. Note
 * `code: null`: the code-driven path cannot see this one.
 */
const toolsPlusEffortRejection = () =>
  new Response(
    JSON.stringify({
      error: {
        message:
          "Function tools with reasoning_effort are not supported for this model in /v1/chat/completions. Please use /v1/responses instead.",
        type: "invalid_request_error",
        param: "reasoning_effort",
        code: null,
      },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );

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

  /**
   * Providers that name the rejected parameter but send NO code.
   *
   * gpt-5.6-luna on Azure refuses `reasoning_effort` when the request also carries
   * function tools, with `code: null`. The repair loop could not see it, so every
   * tool-using call failed permanently: a full cost-test run lost legal research
   * three times over (94 such 400s, 0 citations) while every tool-less feature
   * succeeded, because retrieval is the only node that binds tools.
   */
  describe("prose rejections (param named, code null)", () => {
    it("drops reasoning_effort and retries when tools are present", async () => {
      const inner = fakeFetch([toolsPlusEffortRejection(), ok()]);
      const res = await unsupportedParamFetch("azure|a|luna", inner.fn)("u", {
        body: JSON.stringify({ reasoning_effort: "low", tools: [{ type: "function" }], messages: [] }),
      } as any);

      expect(res.status).toBe(200);
      expect(inner.bodies[1].reasoning_effort).toBeUndefined();
      expect(inner.bodies[1].tools).toBeDefined(); // the TOOLS are the point of the call
    });

    it("remembers the verdict, so later tool calls never re-pay the failed round-trip", async () => {
      const first = fakeFetch([toolsPlusEffortRejection(), ok()]);
      await unsupportedParamFetch("azure|a|luna", first.fn)("u", {
        body: JSON.stringify({ reasoning_effort: "low", tools: [{ type: "function" }] }),
      } as any);

      const second = fakeFetch([ok()]);
      await unsupportedParamFetch("azure|a|luna", second.fn)("u", {
        body: JSON.stringify({ reasoning_effort: "high", tools: [{ type: "function" }] }),
      } as any);
      expect(second.calls).toHaveBeenCalledTimes(1);
      expect(second.bodies[0].reasoning_effort).toBeUndefined();
    });

    /**
     * The conditional half. `modelKey` is provider|instance|model, so a base tier
     * and a `_LARGE` tier pointed at one deployment share a verdict entry. Learning
     * this refusal unconditionally would strip thinking from tool-less calls too —
     * silently undoing a deliberate AI_REASONING_EFFORT_LARGE=high.
     */
    it("leaves reasoning_effort ALONE on a tool-less call to the same deployment", async () => {
      const first = fakeFetch([toolsPlusEffortRejection(), ok()]);
      await unsupportedParamFetch("azure|a|luna", first.fn)("u", {
        body: JSON.stringify({ reasoning_effort: "low", tools: [{ type: "function" }] }),
      } as any);

      const second = fakeFetch([ok()]);
      await unsupportedParamFetch("azure|a|luna", second.fn)("u", {
        body: JSON.stringify({ reasoning_effort: "high", messages: [] }),
      } as any);
      expect(second.bodies[0].reasoning_effort).toBe("high");
    });

    it("ignores a validation error that merely names a parameter", async () => {
      // "must be between" is a bad VALUE, not an unsupported capability. Dropping
      // the parameter would hide a real misconfiguration.
      const payload = JSON.stringify({
        error: {
          message: "temperature must be between 0 and 2.",
          type: "invalid_request_error",
          param: "temperature",
          code: null,
        },
      });
      const inner = fakeFetch([new Response(payload, { status: 400 }), ok()]);
      const res = await unsupportedParamFetch("azure|a|m", inner.fn)("u", {
        body: JSON.stringify({ temperature: 5 }),
      } as any);

      expect(res.status).toBe(400);
      expect(inner.calls).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The UNCONDITIONAL half of the prose fallback. Observed live on 2026-08-18
   * against gpt-5.6-luna on the Responses API (`/openai/v1/responses`): a plain
   * capability rejection, `code: null`, no clashing parameter — the deployment
   * simply does not accept `temperature` at all. Fatal in production because the
   * app always sends a default `temperature: 0.2`.
   */
  describe("unconditional prose rejections (Responses API, no clash parameter)", () => {
    it("drops an uncoded 'Unsupported parameter' rejection and retries", async () => {
      const payload = JSON.stringify({
        error: {
          message: "Unsupported parameter: 'temperature' is not supported with this model.",
          type: "invalid_request_error",
          param: "temperature",
          code: null,
        },
      });
      const first = fakeFetch([new Response(payload, { status: 400 }), ok()]);
      const res = await unsupportedParamFetch("azure|a|luna", first.fn)("u", {
        body: JSON.stringify({ temperature: 0.2, model: "gpt-5.6-luna" }),
      } as any);

      expect(res.status).toBe(200);
      expect(first.bodies[1]).toEqual({ model: "gpt-5.6-luna" });

      // A second wrapper — ModelService builds a fresh one per call — is
      // pre-repaired before the round-trip: the verdict was remembered.
      const second = fakeFetch([ok()]);
      const res2 = await unsupportedParamFetch("azure|a|luna", second.fn)("u", {
        body: JSON.stringify({ temperature: 0.2, model: "gpt-5.6-luna" }),
      } as any);

      expect(res2.status).toBe(200);
      expect(second.calls).toHaveBeenCalledTimes(1);
      expect(second.bodies[0]).toEqual({ model: "gpt-5.6-luna" });
    });

    it("still ignores a validation error, even though it names the same parameter", async () => {
      // "must be between" is a bad VALUE, not an unsupported capability — the
      // unconditional pattern is anchored to "Unsupported parameter:" and must
      // not also swallow this.
      const payload = JSON.stringify({
        error: {
          message: "temperature must be between 0 and 2.",
          type: "invalid_request_error",
          param: "temperature",
          code: null,
        },
      });
      const inner = fakeFetch([new Response(payload, { status: 400 })]);
      const res = await unsupportedParamFetch("azure|a|luna", inner.fn)("u", {
        body: JSON.stringify({ temperature: 5 }),
      } as any);

      expect(res.status).toBe(400);
      expect(inner.calls).toHaveBeenCalledTimes(1);
    });

    it("renames max_tokens through the uncoded prose path instead of dropping it", async () => {
      const payload = JSON.stringify({
        error: {
          message: "Unsupported parameter: 'max_tokens' is not supported with this model.",
          type: "invalid_request_error",
          param: "max_tokens",
          code: null,
        },
      });
      const inner = fakeFetch([new Response(payload, { status: 400 }), ok()]);
      await unsupportedParamFetch("azure|a|luna", inner.fn)("u", {
        body: JSON.stringify({ max_tokens: 28000, model: "gpt-5.6-luna" }),
      } as any);

      expect(inner.bodies[1]).toEqual({ max_completion_tokens: 28000, model: "gpt-5.6-luna" });
    });
  });

  describe("nested-parameter rejections (reasoning.effort)", () => {
    beforeEach(() => resetLearnedUnsupportedParams());

    const rejection = (param: string, message: string) =>
      new Response(
        JSON.stringify({ error: { message, type: "invalid_request_error", param, code: "unsupported_value" } }),
        { status: 400 },
      );

    const ok = () => new Response(JSON.stringify({ id: "resp_1" }), { status: 200 });

    it("substitutes 'none' with 'minimal' when the provider rejects it, instead of dropping", async () => {
      const bodies: any[] = [];
      const inner = vi.fn(async (_input: any, init: any) => {
        bodies.push(JSON.parse(init.body));
        return bodies.length === 1
          ? rejection("reasoning.effort", "Unsupported value: 'none' is not supported with the 'gpt-5-nano' model.")
          : ok();
      });
      const fetch = unsupportedParamFetch("azure|inst|gpt-5-nano", inner as any);

      const res = await fetch("https://x/openai/v1/responses", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5-nano", input: "ok", reasoning: { effort: "none" } }),
      });

      expect(res.status).toBe(200);
      expect(bodies[1].reasoning).toEqual({ effort: "minimal" });
    });

    it("remembers the substitution — the next request is repaired BEFORE the round-trip", async () => {
      const bodies: any[] = [];
      let first = true;
      const inner = vi.fn(async (_input: any, init: any) => {
        bodies.push(JSON.parse(init.body));
        if (first) {
          first = false;
          return rejection("reasoning.effort", "Unsupported value: 'none' is not supported.");
        }
        return ok();
      });
      const fetch = unsupportedParamFetch("azure|inst|gpt-5-nano", inner as any);
      const body = JSON.stringify({ model: "gpt-5-nano", input: "ok", reasoning: { effort: "none" } });

      await fetch("https://x", { method: "POST", body });
      await fetch("https://x", { method: "POST", body });

      // call 1 (rejected) + call 1 retry + call 2 (pre-repaired) = 3 round-trips, not 4
      expect(bodies).toHaveLength(3);
      expect(bodies[2].reasoning).toEqual({ effort: "minimal" });
    });

    it("drops the nested parameter when the successor value is ALSO rejected", async () => {
      const bodies: any[] = [];
      const inner = vi.fn(async (_input: any, init: any) => {
        const b = JSON.parse(init.body);
        bodies.push(b);
        if (b.reasoning?.effort)
          return rejection("reasoning.effort", `Unsupported value: '${b.reasoning.effort}' is not supported.`);
        return ok();
      });
      const fetch = unsupportedParamFetch("azure|inst|weird-model", inner as any);

      const res = await fetch("https://x", {
        method: "POST",
        body: JSON.stringify({ model: "weird-model", input: "ok", reasoning: { effort: "none" } }),
      });

      expect(res.status).toBe(200);
      // none rejected → minimal sent → minimal rejected → whole reasoning key dropped
      expect(bodies.at(-1)!.reasoning).toBeUndefined();
    });

    it("substitutes 'minimal' with 'none' — the mapping is symmetric (luna rejects minimal)", async () => {
      const bodies: any[] = [];
      const inner = vi.fn(async (_input: any, init: any) => {
        bodies.push(JSON.parse(init.body));
        return bodies.length === 1
          ? rejection(
              "reasoning.effort",
              "Unsupported value: 'minimal' is not supported with the 'gpt-5.6-luna' model.",
            )
          : ok();
      });
      const fetch = unsupportedParamFetch("azure|inst|gpt-5.6-luna", inner as any);

      await fetch("https://x", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.6-luna", input: "ok", reasoning: { effort: "minimal" } }),
      });

      expect(bodies[1].reasoning).toEqual({ effort: "none" });
    });

    it("leaves a value-scoped nested verdict alone when the request carries an accepted value", async () => {
      const bodies: any[] = [];
      let first = true;
      const inner = vi.fn(async (_input: any, init: any) => {
        bodies.push(JSON.parse(init.body));
        if (first) {
          first = false;
          return rejection("reasoning.effort", "Unsupported value: 'none' is not supported.");
        }
        return ok();
      });
      const fetch = unsupportedParamFetch("azure|inst|gpt-5-nano", inner as any);

      await fetch("https://x", {
        method: "POST",
        body: JSON.stringify({ model: "m", input: "ok", reasoning: { effort: "none" } }),
      });
      await fetch("https://x", {
        method: "POST",
        body: JSON.stringify({ model: "m", input: "ok", reasoning: { effort: "low" } }),
      });

      // "low" was never rejected — it must go out untouched.
      expect(bodies.at(-1)!.reasoning).toEqual({ effort: "low" });
    });
  });
});

/**
 * `error.param` in a 400 response is attacker-influenced input — the provider
 * chose the string, and the middleware trusted it blindly. A naive `key in
 * node` walk follows the PROTOTYPE chain (`"constructor" in {}` is true), so a
 * crafted `param: "constructor.prototype.toString"` could land `deletePath` on
 * the REAL, shared `Object.prototype` — process-wide corruption from a single
 * remote 400. These tests prove the path helpers refuse to traverse there.
 */
describe("path safety — no prototype-chain traversal", () => {
  afterEach(() => resetLearnedUnsupportedParams());

  it("refuses to repair a __proto__ path — no round-trip, Object.prototype.toString intact", async () => {
    const before = Object.prototype.toString;
    const inner = fakeFetch([rejection("__proto__.toString")]);

    const res = await unsupportedParamFetch("azure|a|m", inner.fn)("u", {
      body: JSON.stringify({ temperature: 0.2 }),
    } as any);

    expect(res.status).toBe(400);
    expect(inner.calls).toHaveBeenCalledTimes(1);
    expect(Object.prototype.toString).toBe(before);
  });

  it("refuses to repair a constructor.prototype path — no round-trip, Object.prototype.hasOwnProperty intact", async () => {
    const before = Object.prototype.hasOwnProperty;
    const inner = fakeFetch([rejection("constructor.prototype.x")]);

    const res = await unsupportedParamFetch("azure|a|m", inner.fn)("u", {
      body: JSON.stringify({ temperature: 0.2 }),
    } as any);

    expect(res.status).toBe(400);
    expect(inner.calls).toHaveBeenCalledTimes(1);
    expect(Object.prototype.hasOwnProperty).toBe(before);
  });
});

/**
 * A dotted path segment can name an ARRAY index ("messages.0.content") — the
 * path helpers must not follow it. Before this fix a coded rejection naming an
 * array index bailed for a different reason (the flat `in` check failed), so
 * this behaviour was never actually exercised; now that `hasPath` traverses
 * dotted paths on purpose, arrays must be excluded explicitly.
 */
describe("path safety — no traversal into arrays", () => {
  afterEach(() => resetLearnedUnsupportedParams());

  it("does not traverse into an array — messages.0.content is refused, not retried", async () => {
    const inner = fakeFetch([rejection("messages.0.content")]);

    const res = await unsupportedParamFetch("azure|a|m", inner.fn)("u", {
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    } as any);

    expect(res.status).toBe(400);
    expect(inner.calls).toHaveBeenCalledTimes(1);
  });
});

/**
 * `tools` / `stream` / `messages` / `input` / `response_format` must never be
 * silently DROPPED — a gateway rejecting `tools` this way would otherwise turn
 * a loud 400 into a silent capability downgrade (the caller believes function
 * calling is available and it simply never fires again for the process). A
 * RENAME or a viable VALUE substitution is still allowed; only an outright
 * drop is refused.
 */
describe("NEVER_DROP — load-bearing parameters refuse to be silently dropped", () => {
  afterEach(() => resetLearnedUnsupportedParams());

  it("does not drop tools on a coded unsupported_parameter rejection — the 400 surfaces instead", async () => {
    const inner = fakeFetch([rejection("tools", "unsupported_parameter")]);

    const res = await unsupportedParamFetch("azure|a|m", inner.fn)("u", {
      body: JSON.stringify({ tools: [{ type: "function" }], model: "m" }),
    } as any);

    expect(res.status).toBe(400);
    expect(inner.calls).toHaveBeenCalledTimes(1);
  });

  it("still drops reasoning_effort (not in NEVER_DROP) on the tools-clash prose path, leaving tools alone", async () => {
    // Regression guard: the NEVER_DROP guard must not touch the EXISTING
    // conditional behaviour — the rejected param there is "reasoning_effort",
    // not "tools", so it stays droppable and `tools` itself is never touched.
    const inner = fakeFetch([toolsPlusEffortRejection(), ok()]);
    const res = await unsupportedParamFetch("azure|a|luna", inner.fn)("u", {
      body: JSON.stringify({ reasoning_effort: "low", tools: [{ type: "function" }], messages: [] }),
    } as any);

    expect(res.status).toBe(200);
    expect(inner.bodies[1].reasoning_effort).toBeUndefined();
    expect(inner.bodies[1].tools).toBeDefined();
  });
});
