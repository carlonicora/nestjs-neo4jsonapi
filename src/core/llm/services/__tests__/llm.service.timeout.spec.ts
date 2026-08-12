import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { LLMService, LLMTimeoutError } from "../llm.service";

/**
 * A provider that accepts a request and never answers used to freeze the caller
 * indefinitely: no timeout was configured anywhere, so the only bound was the
 * OpenAI SDK's own 600s default (game e51493e4 r002 — a 639s plotter stall with
 * no log, no dump and no error). These tests pin the two guarantees that
 * replaced that silence: every attempt carries a budget, and the call ALWAYS
 * settles.
 */

vi.mock("@langchain/core/messages", () => ({
  AIMessage: class {
    content = "";
    tool_calls: any[] = [];
  },
  BaseMessage: class {},
  HumanMessage: class {
    constructor(public content: string) {}
  },
  SystemMessage: class {
    constructor(public content: string) {}
  },
  ToolMessage: class {
    constructor(opts: { content: string; tool_call_id: string }) {
      Object.assign(this, opts);
    }
  },
}));

vi.mock("@langchain/core/prompts", () => ({
  ChatPromptTemplate: {
    fromMessages: vi.fn().mockReturnValue({ formatMessages: vi.fn().mockResolvedValue([]) }),
  },
  MessagesPlaceholder: class {
    constructor(public name: string) {}
  },
}));

vi.mock("@langchain/core/tools", () => ({
  DynamicStructuredTool: class {
    constructor(public fields: any) {}
  },
}));

const AI_CONFIG = {
  mock: false,
  requestTimeoutMs: 40_000,
  requestDeadlineAttempts: 2,
  requestWatchdogMs: 10_000,
};

function harness(opts: { invoke: () => Promise<any>; ai?: Record<string, unknown> }) {
  const model = {
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: opts.invoke }),
    bindTools: vi.fn().mockReturnValue({ invoke: opts.invoke }),
  };
  const modelService = {
    getResolvedConfig: () => ({ model: "m", provider: "openrouter" }),
    getLLM: vi.fn().mockReturnValue(model),
    supportsStrictStructuredOutput: vi.fn().mockReturnValue(true),
  } as any;
  const dumper = {
    startSession: () => ({
      recordInputs: vi.fn(),
      startIteration: vi.fn(),
      recordResponse: vi.fn(),
      recordToolResult: vi.fn(),
      close: vi.fn(),
    }),
  } as any;
  const config = { get: vi.fn().mockReturnValue({ ...AI_CONFIG, ...(opts.ai ?? {}) }) } as any;
  return { svc: new LLMService(modelService, config, dumper), modelService };
}

const OUTPUT = z.object({ ok: z.boolean() });
const callParams = {
  systemPrompts: ["s"],
  inputParams: { a: 1 },
  outputSchema: OUTPUT,
  metadata: { nodeName: "plotter" },
};

describe("LLMService request bounds", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects with LLMTimeoutError when the provider never answers", async () => {
    // The stall: an invocation whose promise never settles, exactly like a
    // request the provider accepted and abandoned.
    const { svc } = harness({ invoke: () => new Promise(() => {}) });

    const pending = svc.call(callParams).catch((e) => e);
    // deadline = requestTimeoutMs (40s) * attempts (2) + 15s slack = 95s
    await vi.advanceTimersByTimeAsync(94_000);
    await vi.advanceTimersByTimeAsync(2_000);

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(String(error.message)).toMatch(/exceeded its 95s deadline/);
  });

  it("aborts the in-flight request when the deadline fires", async () => {
    let seenSignal: AbortSignal | undefined;
    const { svc } = harness({
      invoke: ((_msgs: unknown, options: any) => {
        seenSignal = options?.signal;
        return new Promise(() => {});
      }) as any,
    });

    const pending = svc.call(callParams).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(96_000);
    await pending;

    // A rejected promise with a live socket behind it is still a leak.
    expect(seenSignal?.aborted).toBe(true);
  });

  it("reports a still-pending call on every watchdog tick", async () => {
    const { svc } = harness({ invoke: () => new Promise(() => {}) });
    const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);

    const pending = svc.call(callParams).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(35_000);

    // 3 ticks at 10s — the stall is visible while it is happening, not after.
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(String(warn.mock.calls[0][0])).toContain("plotter:m");
    expect(String(warn.mock.calls[0][0])).toContain("still pending");

    await vi.advanceTimersByTimeAsync(70_000);
    await pending;
  });

  it("gives the model the per-attempt budget, so each attempt can be retried", async () => {
    const { svc, modelService } = harness({
      invoke: () => Promise.resolve({ parsed: { ok: true }, raw: {} }),
    });

    await svc.call(callParams);

    expect(modelService.getLLM).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 40_000 }));
  });

  it("lets a caller widen the budget for a legitimately slow call", async () => {
    const { svc, modelService } = harness({
      invoke: () => Promise.resolve({ parsed: { ok: true }, raw: {} }),
    });

    await svc.call({ ...callParams, timeout: 400_000 });

    expect(modelService.getLLM).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 400_000 }));
  });

  it("leaves a call that answers in time untouched", async () => {
    const { svc } = harness({ invoke: () => Promise.resolve({ parsed: { ok: true }, raw: {} }) });

    const result = await svc.call(callParams);

    expect(result.ok).toBe(true);
    // No timer survives a settled call — the watchdog must not outlive it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-issues a timed-out attempt once, on the SAME model instance", async () => {
    // The reroute only works if the retry reuses the instance whose
    // openRouterEscalatingFetch closure has already escalated — a fresh
    // getLLM() would reset the pin and retry onto the same dead provider.
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ parsed: { ok: true }, raw: {} });
    const { svc, modelService } = harness({ invoke: invoke as any });

    const result = await svc.call(callParams);

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(modelService.getLLM).toHaveBeenCalledTimes(1);
  });

  it("does not re-issue anything that is not a timeout", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("402 insufficient credits"));
    const { svc } = harness({ invoke: invoke as any });

    await expect(svc.call(callParams)).rejects.toThrow(/insufficient credits/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("retries a transient DNS failure, on a FRESH abort controller", async () => {
    // The crash this exists for: 28 ENOTFOUND failures under load, every one of
    // them already through LangChain's ~6 fast internal retries.
    const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND api.openrouter.ai"), { code: "ENOTFOUND" });
    const signals: Array<AbortSignal | undefined> = [];
    const invoke = vi.fn((_msgs: unknown, options: any) => {
      signals.push(options?.signal);
      return signals.length === 1 ? Promise.reject(enotfound) : Promise.resolve({ parsed: { ok: true }, raw: {} });
    });
    const { svc } = harness({ invoke: invoke as any });

    const pending = svc.call(callParams);
    // The outer wait is LONG on purpose — the fast retries are already spent.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_000);

    expect((await pending).ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    // A controller that has aborted stays aborted: reusing the first one would
    // make every retry abort before sending a byte.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("gives up after two extra attempts and keeps the original error as `cause`", async () => {
    const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND api.openrouter.ai"), { code: "ENOTFOUND" });
    const invoke = vi.fn().mockRejectedValue(enotfound);
    const { svc } = harness({ invoke: invoke as any });

    const failure = svc.call(callParams).catch((e) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    const error = await failure;

    expect(invoke).toHaveBeenCalledTimes(3);
    // The message stays byte-for-byte what callers already match on…
    expect(error.message).toBe("LLM service error: getaddrinfo ENOTFOUND api.openrouter.ai");
    // …and the diagnosis is no longer thrown away with the original error.
    expect((error.cause as any).code).toBe("ENOTFOUND");
  });

  it("retries a 429, which is the same kind of transient as a socket failure", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce({ parsed: { ok: true }, raw: {} });
    const { svc } = harness({ invoke: invoke as any });

    const pending = svc.call(callParams);
    await vi.advanceTimersByTimeAsync(7_000);

    expect((await pending).ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not retry a provider refusal, and still preserves its cause", async () => {
    const refusal = Object.assign(new Error("402 insufficient credits"), { status: 402 });
    const invoke = vi.fn().mockRejectedValue(refusal);
    const { svc } = harness({ invoke: invoke as any });

    const error = await svc.call(callParams).catch((e) => e);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(error.cause).toBe(refusal);
  });

  it("bounds extractViaTool the same way", async () => {
    const { svc, modelService } = harness({ invoke: () => new Promise(() => {}) });

    const pending = svc
      .extractViaTool({
        systemPrompts: ["s"],
        prompt: "p",
        tool: { name: "extract", description: "d", schema: OUTPUT },
      })
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(96_000);

    expect(await pending).toBeInstanceOf(LLMTimeoutError);
    expect(modelService.getLLM).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 40_000 }));
  });
});
