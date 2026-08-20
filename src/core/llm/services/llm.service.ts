import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as ai from "ai";
import { wrapAISDK } from "langsmith/experimental/vercel";
import { ZodType } from "zod";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { TOKEN_USAGE_RECORDER, TokenUsageRecorderInterface } from "../../../common/tokens";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { TokenUsageType } from "../../../foundations/tokenusage/enums/tokenusage.type";
import {
  TokenUsageRatesInterface,
  TokenUsageService,
} from "../../../foundations/tokenusage/services/tokenusage.service";
import { ResolvedAiCandidate } from "../interfaces/ai-candidate.interface";
import { ModelWeight } from "../enums/model.weight";
import { ReasoningEffort } from "../enums/reasoning.effort";
import { LLMCacheService, buildCacheKey } from "./llm-cache.service";
import { ModelService } from "../../llm/services/model.service";
import {
  convertZodToDraftJsonSchema,
  convertZodToJsonSchema,
  extractSchemaMetadata,
  formatFieldWithDescription,
  isStrictStructuredOutputCompatible,
  makeSchemaStrictCompatible,
  sanitizeSchemaForGemini,
  stripSyntheticNulls,
} from "../../llm/utils/schema.utils";
import { mockFromZodSchema } from "../utils/mock-from-zod";
import { repairTruncatedJson } from "../utils/repair-truncated-json";
import { LLMRawResponse, StructuredOutputResponse, isValidRaw } from "../common/llm-raw-response";
import { DumpSession, DumpSessionStartParams, LLMCallDumper } from "./llm-call-dumper.service";
import { openRouterEscalatingFetch } from "./openrouter-fetch";
import {
  REPEATED_TOOL_FAILURE_LIMIT,
  describeToolInputRejection,
  repeatedToolFailureMessage,
  toolCallSignature,
} from "./tool-error-feedback";

// LangSmith tracing for the Vercel AI SDK streaming path. `wrapAISDK` wraps the
// SDK functions; when LangSmith tracing is disabled (no LANGSMITH_TRACING /
// LANGSMITH_API_KEY) it is a pure passthrough — no behaviour change, no overhead.
// The LangChain / LangGraph path (call/extractViaTool/_invokeOriginal via
// `.invoke(...)`) is already traced natively via the same env vars and the
// `metadata` we forward in configOptions; this closes the streaming gap so
// `narrate` and structured streaming also appear in the trace tree.
const { streamText, streamObject } = wrapAISDK(ai);

// Re-export for the existing test import path.
export { injectOpenRouterProvider } from "./openrouter-fetch";

/** Fallbacks used only when no `ai` config block is registered (test harnesses). */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_REQUEST_WATCHDOG_MS = 30_000;
const DEFAULT_REQUEST_DEADLINE_ATTEMPTS = 3;
/** Grace on top of the budgeted attempts, covering backoff between retries. */
const DEADLINE_SLACK_MS = 15_000;
/**
 * How long a FAILED stream may wait for its `usage` promise before giving up on
 * it. Unlike `call()`, a stream's `result` promise runs under no outer deadline,
 * so an unbounded await in its catch would replace a settled rejection with a
 * caller that hangs forever. Two seconds is generous for a promise the SDK has
 * normally already settled, and irrelevant to the happy path.
 */
const USAGE_SETTLE_TIMEOUT_MS = 2_000;

/**
 * Waits before each EXTRA attempt of the transient-network retry, in ms — two
 * extras, so three attempts in total.
 *
 * Deliberately LONG. LangChain's `AsyncCaller` already retries roughly six times
 * FAST underneath every `.invoke(...)`, so by the time a failure surfaces here
 * the quick retries are spent and the fault has lasted seconds, not
 * milliseconds — a DNS outage, a provider brown-out, a saturated egress NAT.
 * Retrying fast again would burn both extra attempts inside the same bad second
 * and change nothing. (Evidence: a crashed worker run with 28 `ENOTFOUND` DNS
 * failures under load, every one of them already through LangChain's fast
 * retries.)
 */
const TRANSIENT_RETRY_WAITS_MS = [5_000, 15_000];

/**
 * Network-level error codes that say "the request never reached a working
 * provider" — the class of failure another attempt can actually fix.
 */
const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
]);

/**
 * True for the abort a request timeout raises, whichever layer raised it — the
 * OpenAI SDK's `APIConnectionTimeoutError`, undici's `TimeoutError`/
 * `AbortError` DOMException, or a LangChain wrapper around either. Matched on
 * name and message because the concrete class differs per transport.
 */
export function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    name === "APIConnectionTimeoutError" ||
    /aborted due to timeout|timed? ?out|Request was aborted/i.test(message)
  );
}

/**
 * True for a failure that means the request never reached a working provider,
 * and is therefore worth another attempt: a DNS/socket-level error code, an
 * HTTP 429 or 5xx, or the message text either of those arrives as.
 *
 * All three are checked because the same failure wears different clothes per
 * transport: undici puts the code on `error.cause.code` behind a bare
 * `TypeError: fetch failed`, the OpenAI SDK puts the status on the error and
 * the code in the message, and LangChain re-wraps both in a plain `Error`.
 *
 * Deliberately NOT transient: a stall that burned its whole deadline
 * ({@link LLMTimeoutError}), a refusal (402/403), a malformed request (400) or
 * a parse failure. Those either already had their retry (`call()` re-issues a
 * timed-out attempt once, escalating the OpenRouter pin) or will fail
 * identically forever. The 429 vocabulary matches the one
 * `VisionLLMService.isRateLimitError` retries on, so the two agree on what a
 * rate limit looks like.
 *
 * Exported as a standalone function (with {@link LLMService} keeping a private
 * method that delegates to it) so the other modality services — which have no
 * `LLMService` dependency and must not grow one — classify a failure by exactly
 * the same rule before failing a connection over to the next candidate.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (err === undefined || err === null) return false;
  const candidate = err as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  const cause = candidate.cause as { code?: unknown; status?: unknown } | undefined;

  const codes = [candidate.code, cause?.code];
  if (codes.some((code) => typeof code === "string" && TRANSIENT_ERROR_CODES.has(code))) return true;

  const statuses = [candidate.status, candidate.statusCode, candidate.response?.status, cause?.status];
  if (statuses.some((status) => typeof status === "number" && (status === 429 || (status >= 500 && status <= 599))))
    return true;

  const own = err instanceof Error ? err.message : String(err);
  const causeMessage = cause instanceof Error ? cause.message : "";
  const haystack = `${own} ${causeMessage}`.toLowerCase();

  for (const code of TRANSIENT_ERROR_CODES) if (haystack.includes(code.toLowerCase())) return true;

  return (
    haystack.includes("socket hang up") ||
    haystack.includes("fetch failed") ||
    haystack.includes("network error") ||
    haystack.includes("econnaborted") ||
    // 429 / rate limiting — matched as a whole word so a token count never
    // reads as a status code.
    /\b429\b/.test(haystack) ||
    haystack.includes("rate limit") ||
    haystack.includes("resource exhausted") ||
    haystack.includes("too many requests") ||
    // 5xx. Only the codes providers actually emit, again whole-word: a blanket
    // /5\d\d/ would retry "context length 512 exceeded" forever.
    /\b(500|502|503|504|529)\b/.test(haystack) ||
    haystack.includes("internal server error") ||
    haystack.includes("bad gateway") ||
    haystack.includes("service unavailable") ||
    haystack.includes("gateway timeout") ||
    haystack.includes("overloaded")
  );
}

/**
 * The failover surface `ModelService` gained with DB-backed AI connections,
 * seen STRUCTURALLY and entirely optionally.
 *
 * Every method is optional on purpose: `LLMService` is constructed directly with
 * hand-written `ModelService` doubles in several spec harnesses, and a consumer
 * may hold an older build of the package. A double without these methods gets
 * exactly the pre-failover behaviour — one candidate, today's three attempts —
 * instead of a `TypeError` on the hot path, which is the same "degrade toward
 * `.env`, never toward no AI" rule the resolver follows.
 */
interface CandidateAwareModelService {
  getCandidates?: (weight?: ModelWeight) => ResolvedAiCandidate[] | undefined;
  notifyCandidateFailure?: (candidate: ResolvedAiCandidate) => void;
}

/**
 * Thrown when a provider call burns its whole deadline without settling.
 * Distinguishable from a provider error so callers can treat a stall
 * differently from a refusal if they choose — both are retryable.
 */
export class LLMTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly deadlineMs: number,
  ) {
    super(`LLM call "${label}" exceeded its ${Math.round(deadlineMs / 1000)}s deadline`);
    this.name = "LLMTimeoutError";
  }
}

/**
 * Parameters for LLM service calls
 */
interface LLMCallParams<T> {
  inputParams: Record<string, any>;
  inputSchema?: ZodType; // Optional Zod schema for input validation and context injection
  outputSchema: ZodType<T>;
  systemPrompts: string[];
  instructions?: string;
  temperature?: number;
  history?: Array<{ role: AgentMessageType; content: string }>;
  maxTokens?: number;
  timeout?: number;
  metadata?: Record<string, any>;
  stopSequences?: string[];
  maxHistoryMessages?: number;
  validateInput?: boolean; // Optional flag to enable input validation (default: false)
  tools?: DynamicStructuredTool[]; // Optional tools to bind to the LLM
  maxToolIterations?: number; // Max tool call iterations (default: 5)
  modelWeight?: ModelWeight; // Optional model tier (lite/normal/large). Default: Normal.
  tokenUsageType?: string; // Optional cost-attribution category. Default: "text_generation". Callers own their own type values.
  relationshipId?: string; // Optional: id of the entity this usage is attributed to.
  relationshipType?: string; // Optional: Neo4j label of the attributed entity. Persistence is skipped unless both relationshipId and relationshipType are set.
  cacheable?: boolean; // Optional: when true, the response is read from / written to the Redis LLM cache keyed on generic params (modelWeight/temperature/systemPrompts/prompt). A hit returns early WITHOUT invoking the provider — and therefore costs no tokens. Default: false.
  disableThinking?: boolean; // Optional: turn off reasoning/"thinking" for this call (maps to reasoning_effort: "none"). Use for fast structured calls on reasoning-capable models. Default: false.
  reasoningEffort?: ReasoningEffort; // Optional: how much hidden reasoning the model may spend. Overrides disableThinking and the tier default. Unset = provider default.
}

/**
 * Best-effort extraction of a JSON object from free-form model text. Local
 * models (notably Gemma over Ollama) routinely ignore a forced `tool_choice`
 * and emit the structured payload as plain text — sometimes bare, sometimes
 * wrapped in a ```json fence or surrounded by prose. Returns the first parseable
 * object, or `null` when none is found. Never throws.
 */
function extractJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParse(fence[1].trim());
    if (fenced) return fenced;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = tryParse(text.slice(start, end + 1));
    if (sliced) return sliced;
  }

  return null;
}

/**
 * Recovers a forced tool call that a Gemma/MLX model emitted as TEXT instead of
 * a structured `tool_calls` entry. These models (e.g. `gemma4:26b-mlx` over
 * Ollama, whose Modelfile template is the bare `{{ .Prompt }}` with no real
 * tool-calling support) leak their native tool format as literal pseudo-tokens:
 *
 *   toolName{key:<|"|>value<|"|>,key:<|"|>value<|"|>}<tool_call|>
 *
 * Ollama can't parse that, so it returns it as `content` with `tool_calls=[]`
 * and `finish_reason=stop`. It is NOT valid JSON (unquoted keys, `<|"|>` quote
 * tokens, values that themselves contain `"`), so `extractJsonObject` misses it.
 * We split on the `<|"|>` pseudo-quote — which never appears inside real text —
 * giving alternating [keyspec, value, keyspec, value, …] and rebuild the object.
 * Returns the recovered object, or `null` when the marker is absent. Never throws.
 */
function parseGemmaToolCallText(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string" || !text.includes('<|"|>')) return null;
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  const body = open >= 0 && close > open ? text.slice(open + 1, close) : text;

  const parts = body.split('<|"|>');
  const obj: Record<string, unknown> = {};
  // Even-indexed parts hold the `…,key:` spec; the following odd part is its value.
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const keyMatch = parts[i].match(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
    if (keyMatch) obj[keyMatch[1]] = parts[i + 1];
  }
  return Object.keys(obj).length > 0 ? obj : null;
}

/**
 * A structured tool call's `args` is usually the parsed object, but models
 * served over Ollama deliver variants that fail strict `safeParse`:
 *  - the raw JSON arguments STRING instead of a parsed object, and/or
 *  - the real payload nested under a single wrapper key (often the tool name):
 *    `{ record_memories: { operations: [...] } }`.
 * Return every plausible shape so the caller can validate each against the
 * schema and accept the first that matches. Order: as-is, JSON-parsed, unwrapped.
 */
function toolArgCandidates(args: unknown): unknown[] {
  const candidates: unknown[] = [args];
  let obj: unknown = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
      candidates.push(obj);
    } catch {
      obj = undefined;
    }
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const keys = Object.keys(obj as Record<string, unknown>);
    if (keys.length === 1) {
      const inner = (obj as Record<string, unknown>)[keys[0]];
      if (inner && typeof inner === "object") candidates.push(inner);
    }
  }
  return candidates;
}

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  /**
   * LangChain's ChatModel.invoke crashes with `TypeError: Cannot read
   * properties of undefined (reading 'message')` when the provider returns a
   * response with no candidates (Gemini does this on malformed function calls
   * and safety blocks). Convert that cryptic internal crash into a clear,
   * retryable error; every other error passes through untouched.
   */
  private static normaliseEmptyResponseError(error: unknown): unknown {
    if (error instanceof TypeError && /reading 'message'/.test(error.message)) {
      return new Error(
        "LLM provider returned an empty response (no candidates — likely a malformed function call or a safety block). Transient: retry the call.",
      );
    }
    return error;
  }

  constructor(
    private readonly modelService: ModelService,
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly dumper: LLMCallDumper,
    private readonly tokenUsageService: TokenUsageService,
    // Optional: the LLM cache is an opt-in optimisation. Marked @Optional so
    // existing test harnesses (and any consumer that doesn't register the
    // cache) keep resolving LLMService; when absent, cacheable calls simply
    // skip the cache and run normally.
    @Optional() private readonly cache?: LLMCacheService,
    // Optional application-provided sink for the usage records written below.
    // See TOKEN_USAGE_RECORDER in common/tokens.ts: `LLMModule` imports the
    // package `TokenUsageModule`, so `tokenUsageService` above is ALWAYS the
    // package implementation, whatever an app aliases in its own module. When
    // this token is bound, persistUsage writes through the app's implementation
    // instead; when it is absent, behaviour is unchanged.
    @Optional() @Inject(TOKEN_USAGE_RECORDER) private readonly tokenUsageRecorder?: TokenUsageRecorderInterface,
  ) {}

  /**
   * The per-ATTEMPT budget for one provider request. `params.timeout` wins;
   * otherwise the configured default (`AI_REQUEST_TIMEOUT_MS`).
   */
  private attemptTimeoutMs(explicit?: number): number {
    return explicit ?? this.config.get<ConfigAiInterface>("ai")?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Reads a stream's `usage` promise WITHOUT ever hanging on it.
   *
   * Used only from the streaming error paths. `streamObject`/`streamText`
   * usually settle `usage` even when `object`/`text` reject — a schema-invalid
   * or aborted generation is still billed — so it is worth awaiting. But the
   * `result` promise those catches belong to has no outer deadline (unlike
   * `call()`, which runs under `runBounded`), so if the SDK ever rejected the
   * content promise while leaving `usage` pending, an unbounded await would turn
   * a prompt rejection into a caller that waits forever. Rejection is handled by
   * `.catch`; PENDENCY is handled by the race. The loser's timer is cleared, so
   * a settled call leaves no timer behind.
   *
   * @returns the usage object, or undefined if it rejected or did not settle in time
   */
  private async readUsageBounded<T>(
    usage: PromiseLike<T>,
    timeoutMs: number = USAGE_SETTLE_TIMEOUT_MS,
  ): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race<T | undefined>([
        Promise.resolve(usage).catch(() => undefined),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Runs one provider call under a WATCHDOG and an ABSOLUTE DEADLINE.
   *
   * Why this exists (game e51493e4 r002, 2026-07-26): a plotter request was
   * accepted by the provider and never answered. Nothing in the stack could
   * interrupt it — no timeout was configured anywhere, the dump file is only
   * written when the call closes, and the callers' retry/fallback wrappers catch
   * ERRORS, not promises that never settle. The round froze for 639 seconds with
   * no log, no dump and no error, and only unfroze because the OpenAI SDK's own
   * 600s default finally fired. Three such stalls are on record (547s, 514s,
   * 639s) across two tiers and two models, so this is a property of talking to a
   * provider, not of one model.
   *
   * Two independent guarantees, because the first one can be ignored by an
   * adapter that owns its own transport:
   *  - the WATCHDOG logs every `requestWatchdogMs` while the call is pending, so
   *    a stall is visible AS IT HAPPENS instead of after it resolves;
   *  - the DEADLINE aborts the signal and rejects with {@link LLMTimeoutError}
   *    once the call has burned its whole attempt budget, so the promise ALWAYS
   *    settles and the caller's existing retry/fallback path gets to run.
   *
   * The deadline is deliberately the LAST line of defence: it budgets
   * `requestDeadlineAttempts` attempts, so in normal operation the per-attempt
   * timeout fires first and the retry escalates the OpenRouter pin onto a
   * healthy provider — which is the outcome we actually want. Reaching the
   * deadline means the adapter never honoured its own timeout.
   */
  private async runBounded<T>(
    label: string,
    attemptTimeoutMs: number,
    controller: AbortController,
    work: () => Promise<T>,
  ): Promise<T> {
    const aiConfig = this.config.get<ConfigAiInterface>("ai");
    const watchdogMs = aiConfig?.requestWatchdogMs ?? DEFAULT_REQUEST_WATCHDOG_MS;
    const attempts = aiConfig?.requestDeadlineAttempts ?? DEFAULT_REQUEST_DEADLINE_ATTEMPTS;
    const deadlineMs = attemptTimeoutMs * Math.max(1, attempts) + DEADLINE_SLACK_MS;

    const startedAt = Date.now();
    const watchdog =
      watchdogMs > 0
        ? setInterval(() => {
            this.logger.warn(
              `[${label}] still pending after ${Math.round((Date.now() - startedAt) / 1000)}s ` +
                `(attempt budget ${Math.round(attemptTimeoutMs / 1000)}s, hard deadline ${Math.round(deadlineMs / 1000)}s)`,
            );
          }, watchdogMs)
        : undefined;
    watchdog?.unref?.();

    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        deadline = setTimeout(() => {
          // Abort first so the in-flight socket is released, then reject — the
          // caller must not be left waiting on a request nobody is reading.
          controller.abort();
          reject(new LLMTimeoutError(label, deadlineMs));
        }, deadlineMs);
        deadline.unref?.();
        work().then(resolve, reject);
      });
    } finally {
      if (watchdog) clearInterval(watchdog);
      if (deadline) clearTimeout(deadline);
    }
  }

  /**
   * See the module-level {@link isTransientNetworkError} for the classification
   * rule and why it lives outside the class. Kept as a method because it is part
   * of this service's shape (spec harnesses stub and assert on it) — the
   * unqualified call below resolves to the module function, not to itself.
   */
  private isTransientNetworkError(err: unknown): boolean {
    return isTransientNetworkError(err);
  }

  /**
   * Ordered failover candidates for a chat tier, newest health state applied.
   *
   * EMPTY means "no candidate machinery available" (a `ModelService` double
   * without `getCandidates`, or a resolution failure) — every caller then
   * behaves exactly as it did before failover existed. A resolution failure is
   * logged and swallowed rather than thrown: losing the chain must degrade to
   * the configured tier, never break the call.
   */
  private resolveCandidates(modelWeight?: ModelWeight): ResolvedAiCandidate[] {
    const resolver = this.modelService as unknown as CandidateAwareModelService;
    if (typeof resolver.getCandidates !== "function") return [];
    try {
      return resolver.getCandidates(modelWeight) ?? [];
    } catch (error) {
      this.logger.warn(`AI candidate resolution failed — using the configured tier only: ${String(error)}`);
      return [];
    }
  }

  /**
   * Puts the candidate that just failed transiently into its cooldown window, so
   * the next resolution skips it. Best-effort in every direction: no candidate,
   * no candidate-aware `ModelService`, or a throwing registry all leave the call
   * itself untouched — bookkeeping must never turn a retryable failure into a
   * hard one.
   */
  private markCandidateFailure(candidate: ResolvedAiCandidate | undefined): void {
    if (!candidate) return;
    const resolver = this.modelService as unknown as CandidateAwareModelService;
    if (typeof resolver.notifyCandidateFailure !== "function") return;
    try {
      resolver.notifyCandidateFailure(candidate);
    } catch (error) {
      this.logger.warn(`Marking AI candidate ${candidate.connectionId} as failed did not succeed: ${String(error)}`);
    }
  }

  /**
   * The cost rates to bill this call at, or undefined to keep the config-block
   * rates.
   *
   * ONLY a DB-backed connection supplies rates: an `.env` candidate is the very
   * config block `computeCost` already reads, so passing its numbers back in
   * would be a no-op at best and a rounding difference at worst. A DB connection
   * that prices nothing also returns undefined, so it bills at the tier rate
   * instead of silently costing zero.
   */
  private ratesForCandidate(candidate: ResolvedAiCandidate | undefined): TokenUsageRatesInterface | undefined {
    if (!candidate || candidate.source !== "db") return undefined;
    const { inputCostPer1MTokens, outputCostPer1MTokens, cachedInputCostPer1MTokens } = candidate;
    if (
      inputCostPer1MTokens === undefined &&
      outputCostPer1MTokens === undefined &&
      cachedInputCostPer1MTokens === undefined
    )
      return undefined;
    // Only the prices the connection actually sets travel: an explicitly
    // undefined key would still have to be reasoned about downstream.
    return {
      ...(inputCostPer1MTokens !== undefined ? { inputCostPer1MTokens } : {}),
      ...(outputCostPer1MTokens !== undefined ? { outputCostPer1MTokens } : {}),
      ...(cachedInputCostPer1MTokens !== undefined ? { cachedInputCostPer1MTokens } : {}),
    };
  }

  /**
   * Sleeps the jittered backoff for one transient retry and says so in the log.
   * ±20% jitter so a fleet of workers knocked out by the same DNS blip does not
   * come back in lockstep and knock it out again.
   */
  private async waitBeforeTransientRetry(
    label: string,
    attempt: number,
    error: unknown,
    /** Total attempts this run budgets — only the log text uses it. Defaults to today's 3. */
    maxAttempts: number = TRANSIENT_RETRY_WAITS_MS.length + 1,
  ): Promise<void> {
    // The wait index clamps to the LAST configured backoff: a failover chain can
    // budget more attempts than there are configured waits, and every extra one
    // waits the longest wait rather than reading past the end of the array.
    const base = TRANSIENT_RETRY_WAITS_MS[Math.min(attempt, TRANSIENT_RETRY_WAITS_MS.length - 1)];
    const waitMs = Math.round(base * (0.8 + Math.random() * 0.4));
    this.logger.warn(
      `[${label}] transient network failure on attempt ${attempt + 1}/${maxAttempts} — ` +
        `retrying in ${Math.round(waitMs / 1000)}s: ${error instanceof Error ? error.message : String(error)}`,
    );
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      timer.unref?.();
    });
  }

  /**
   * Runs a provider call under {@link runBounded}, retrying it when — and only
   * when — it failed for a transient network reason
   * ({@link isTransientNetworkError}). Two extra attempts by default, with the
   * long jittered waits {@link TRANSIENT_RETRY_WAITS_MS} explains.
   *
   * Owns a FRESH AbortController per attempt: a controller that has already
   * aborted stays aborted forever, so re-using one would make every retry abort
   * before it sent a byte. `work` therefore receives the signal rather than
   * capturing one from the caller.
   *
   * `work` also receives the ATTEMPT INDEX, which is what turns this retry into
   * a failover: `call()` uses it to pick the n-th connection of the chain, so
   * attempt 2 of a 429 storm talks to a different provider instead of knocking
   * on the same closed door. Callers that pass no `options` keep today's budget
   * (three attempts, the two configured waits) exactly.
   */
  private async runWithTransientRetry<T>(
    label: string,
    attemptTimeoutMs: number,
    work: (signal: AbortSignal, attempt: number) => Promise<T>,
    options?: {
      /** Total attempts. Default `TRANSIENT_RETRY_WAITS_MS.length + 1` (= 3, today's). */
      maxAttempts?: number;
      /** Invoked once per transient failure, before the backoff wait. */
      onTransientFailure?: (attempt: number, error: unknown) => void;
    },
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? TRANSIENT_RETRY_WAITS_MS.length + 1;
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      try {
        return await this.runBounded(label, attemptTimeoutMs, controller, () => work(controller.signal, attempt));
      } catch (error) {
        if (attempt >= maxAttempts - 1 || !this.isTransientNetworkError(error)) throw error;
        options?.onTransientFailure?.(attempt, error);
        // The attempt is over; release whatever socket it may still hold before
        // waiting out the backoff.
        controller.abort();
        await this.waitBeforeTransientRetry(label, attempt, error, maxAttempts);
      }
    }
  }

  /**
   * Records token usage for cost/observability attribution. Never throws —
   * a persistence failure logs a warning and the LLM call continues, so
   * observability problems can't break the primary request path.
   *
   * Writes through the application-provided `TOKEN_USAGE_RECORDER` when one is
   * bound, falling back to the module-local `TokenUsageService` otherwise. This
   * is the ONLY token-usage write inside the package; any future package caller
   * MUST use the same token rather than injecting `TokenUsageService` directly
   * (see the token's docblock for why).
   *
   * ZERO-TOKEN SUCCESS RULE: a call that SUCCEEDED but reported no usage at all
   * (the provider omitted `usage_metadata`) is still recorded — the call really
   * happened and must stay visible — but with `applyMinimum: false`, so it
   * costs 0 credits instead of being floored to `minCreditsPerRecord`. Flooring
   * exists to stop sub-cent REAL usage rounding to nothing, not to invent a
   * charge for tokens nobody measured. A success carrying real counts keeps the
   * floor exactly as before.
   *
   * This is deliberately NOT the same rule as the zero-token FAILURE rule in
   * {@link persistUsageOnFailure}, which writes nothing at all: there the
   * provider was never reached, so there is no call to make visible.
   */
  private async persistUsage(
    params: {
      tokenUsageType?: string;
      relationshipId?: string;
      relationshipType?: string;
      modelWeight?: ModelWeight;
    },
    tokens: { input: number; output: number; cached?: number },
    /**
     * Rates of the AI connection that actually served the call — see
     * {@link ratesForCandidate}. Omitted (the default, and always so for
     * `.env`-served calls) the recorder prices the call from the config block,
     * exactly as before.
     */
    rates?: TokenUsageRatesInterface,
  ): Promise<void> {
    // Attribution is opt-in: the caller decides which entity this usage is
    // recorded against. With no relationship, there is nothing to attribute to,
    // so we skip — the package stays domain-agnostic.
    if (!params.relationshipId || !params.relationshipType) return;
    const measured = tokens.input + tokens.output + (tokens.cached ?? 0) > 0;
    try {
      // Built as a variable rather than inline so `rates` reaches the package
      // TokenUsageService without widening the published
      // `TokenUsageRecorderInterface`: an application recorder that predates
      // per-connection rates simply ignores the extra key and keeps pricing
      // from its own config, which is the correct degradation.
      const usage = {
        tokens,
        type: params.tokenUsageType ?? TokenUsageType.TextGeneration,
        relationshipId: params.relationshipId,
        relationshipType: params.relationshipType,
        modelWeight: params.modelWeight,
        ...(measured ? {} : { applyMinimum: false }),
        ...(rates ? { rates } : {}),
      };
      await (this.tokenUsageRecorder ?? this.tokenUsageService).recordTokenUsage(usage);
    } catch (err) {
      this.logger.warn(`TokenUsage persistence failed — continuing: ${String(err)}`);
    }
  }

  /**
   * Records what a FAILED call already burned. A failure is not a free call:
   * the provider bills every round it served, so a tool loop that dies on its
   * final structured invocation has already been charged for six figures of
   * input tokens. Billing only successful calls understates real spend.
   *
   * ZERO-TOKEN RULE: a failure that consumed nothing (the provider was never
   * reached — input validation, an unreachable host, an immediate abort) is NOT
   * recorded. `recordTokenUsage` floors every record at `minCreditsPerRecord`,
   * so writing a 0/0 row would invent a charge for tokens nobody spent; the
   * floor exists to stop sub-cent REAL usage rounding to nothing, not to price
   * a call that never happened. Such failures remain fully visible through the
   * dump session, which closes with `finalStatus: "error"`.
   *
   * Never throws (delegates to {@link persistUsage}), so it can sit in a catch
   * block without masking the original error.
   */
  private async persistUsageOnFailure(
    params: {
      tokenUsageType?: string;
      relationshipId?: string;
      relationshipType?: string;
      modelWeight?: ModelWeight;
    },
    tokens: { input: number; output: number; cached?: number },
    /** See {@link persistUsage}: rates of the connection that served the call. */
    rates?: TokenUsageRatesInterface,
  ): Promise<void> {
    if (tokens.input + tokens.output + (tokens.cached ?? 0) === 0) return;
    await this.persistUsage(params, tokens, rates);
  }

  /**
   * Converts AgentMessageType to LangChain BaseMessage
   */
  private _convertToBaseMessage(role: AgentMessageType, content: string): BaseMessage {
    switch (role) {
      case AgentMessageType.System:
        return new SystemMessage(content);
      case AgentMessageType.Assistant:
        return new AIMessage(content);
      case AgentMessageType.User:
        return new HumanMessage(content);
      default:
        return new HumanMessage(content);
    }
  }

  /**
   * Trims history to prevent context overflow
   */
  private _trimHistory(
    history: Array<{ role: AgentMessageType; content: string }>,
    maxMessages?: number,
  ): Array<{ role: AgentMessageType; content: string }> {
    if (!maxMessages || history.length <= maxMessages) {
      return history;
    }

    // Keep the most recent messages
    const trimmed = history.slice(-maxMessages);

    return trimmed;
  }

  /**
   * Auto-generates instructions from input parameters
   *
   * Formats parameters as "key: value" pairs separated by double newlines.
   * Handles primitives, objects, and arrays intelligently.
   *
   * IMPORTANT: For objects/arrays, curly braces are escaped with double braces
   * ({{ and }}) to prevent ChatPromptTemplate from treating them as template
   * variables. ChatPromptTemplate will render {{ as literal { in the final prompt.
   *
   * @param inputParams - Parameters to format
   * @returns Formatted instruction string with escaped braces, or empty string if no params
   */
  private _autoGenerateInstructions(inputParams: Record<string, any>): string {
    const keys = Object.keys(inputParams);

    if (keys.length === 0) {
      return "";
    }

    // const formattedPairs = keys.map((key) => {
    //   const value = inputParams[key];

    //   // Format the value based on its type
    //   let formattedValue: string;
    //   if (value === null || value === undefined) {
    //     formattedValue = String(value);
    //   } else if (typeof value === "object") {
    //     // For objects/arrays, use JSON stringify with formatting
    //     // CRITICAL: Escape curly braces for ChatPromptTemplate
    //     // Single braces {} are interpreted as template variables
    //     // Double braces {{}} render as literal {} in the output
    //     formattedValue = JSON.stringify(value, null, 2).replace(/{/g, "{{").replace(/}/g, "}}");
    //   } else {
    //     formattedValue = String(value);
    //   }

    //   return `${key}: ${formattedValue}`;
    // });
    const formattedPairs = keys.map((key) => {
      const value = inputParams[key];

      let formattedValue: string;
      if (value === null || value === undefined) {
        formattedValue = String(value);
      } else if (typeof value === "object") {
        formattedValue = JSON.stringify(value, null, 2).replace(/{/g, "{{").replace(/}/g, "}}");
      } else {
        // ✅ FIX: Escape braces in string values too!
        formattedValue = String(value).replace(/{/g, "{{").replace(/}/g, "}}");
      }

      return `${key}: ${formattedValue}`;
    });

    return formattedPairs.join("\n\n");
  }

  /**
   * Generates schema-guided instructions with inline descriptions
   *
   * This method enhances auto-generated instructions by including field descriptions
   * from the input schema. This provides the LLM with semantic context about each
   * input parameter, improving understanding and adherence to constraints.
   *
   * Benefits:
   * - LLM understands field purposes (e.g., "use likes to SUBTLY influence tone")
   * - LLM receives explicit constraints (e.g., "FORBIDDEN - never repeat these")
   * - Reduces need for redundant explanations in system prompts
   * - Single source of truth for input semantics
   *
   * Format: "fieldName (description): value"
   *
   * @param inputParams - Parameters to format (actual values)
   * @param inputSchema - Optional Zod schema with descriptions
   * @returns Formatted instruction string with inline descriptions
   *
   * @example Without schema (fallback to auto-generation):
   * ```typescript
   * _generateSchemaGuidedInstructions({ name: "Alice" })
   * // Returns: "name: Alice"
   * ```
   *
   * @example With schema (includes descriptions):
   * ```typescript
   * const schema = z.object({
   *   name: z.string().describe("The user's name"),
   *   recentActions: z.array(z.string()).describe("FORBIDDEN - never repeat")
   * });
   * _generateSchemaGuidedInstructions({ name: "Alice", recentActions: ["wave"] }, schema)
   * // Returns:
   * // "name (The user's name): Alice
   * //
   * // recentActions (FORBIDDEN - never repeat): ["wave"]"
   * ```
   */
  private _generateSchemaGuidedInstructions(inputParams: Record<string, any>, inputSchema?: ZodType): string {
    const keys = Object.keys(inputParams);

    if (keys.length === 0) {
      return "";
    }

    // If no schema provided, fall back to basic auto-generation
    if (!inputSchema) {
      return this._autoGenerateInstructions(inputParams);
    }

    // Extract schema metadata (field descriptions)
    const schemaMetadata = extractSchemaMetadata(inputSchema);

    // Format each field with its description (if available)
    const formattedPairs = keys.map((key) => {
      const value = inputParams[key];
      const fieldMetadata = schemaMetadata.fields[key];

      return formatFieldWithDescription(key, value, fieldMetadata?.description);
    });

    return formattedPairs.join("\n\n");
  }

  /**
   * Creates message array for ChatPromptTemplate using MessagesPlaceholder pattern
   */
  private _createMessages(params: {
    systemPrompts: string[];
    instructions?: string;
    inputParams: Record<string, any>;
    inputSchema?: ZodType;
    history?: Array<{ role: AgentMessageType; content: string }>;
    maxHistoryMessages?: number;
  }): {
    template: Array<[AgentMessageType, string] | MessagesPlaceholder>;
    historyMessages: BaseMessage[];
  } {
    const templateMessages: Array<[AgentMessageType, string] | MessagesPlaceholder> = [];

    // Add system prompts
    params.systemPrompts.forEach((systemPrompt) => {
      templateMessages.push([AgentMessageType.System, systemPrompt.replace(/{/g, "{{").replace(/}/g, "}}")]);
    });

    // Add placeholder for conversation history (modern LangChain pattern)
    templateMessages.push(new MessagesPlaceholder("chat_history"));

    // Determine final instructions: use provided or generate with schema guidance
    const finalInstructions =
      params.instructions || this._generateSchemaGuidedInstructions(params.inputParams, params.inputSchema);

    // Add instructions with {placeholders} intact - ChatPromptTemplate will substitute them
    templateMessages.push([AgentMessageType.User, finalInstructions]);

    // Prepare history messages
    let historyToUse = params.history || [];

    // Trim history if needed
    if (params.maxHistoryMessages) {
      historyToUse = this._trimHistory(historyToUse, params.maxHistoryMessages);
    }

    // Convert to BaseMessage format
    const historyMessages = historyToUse.map((entry) => this._convertToBaseMessage(entry.role, entry.content));

    return {
      template: templateMessages,
      historyMessages,
    };
  }

  /**
   * Calls the LLM with structured input/output using LangChain.
   *
   * This method:
   * 1. Builds a chat prompt from system prompts, history, and user instructions
   * 2. Auto-generates instructions from inputParams if not provided
   * 3. Trims history if maxHistoryMessages is specified (prevents context overflow)
   * 4. Substitutes {placeholders} in instructions with values from inputParams
   * 5. Calls the LLM with structured output enforcement (via function calling)
   * 6. Implements automatic retry logic with exponential backoff
   * 7. Returns the parsed response with token usage metadata
   * 8. Tracks session-level token usage
   *
   * @template T - The expected output type (inferred from outputSchema)
   *
   * @param params - Call parameters
   * @param params.inputParams - Variables to substitute in instruction template, or to auto-generate
   *                              Keys match {placeholders} in instructions (if provided)
   *                              Example: {character: {...}, userMessage: "Hello"}
   * @param params.inputSchema - Optional Zod schema for input validation and context injection
   *                              Field descriptions are extracted and included in prompts
   * @param params.outputSchema - Zod schema defining expected LLM response structure
   * @param params.systemPrompts - Array of system prompts to set context/behavior
   * @param params.instructions - Optional user instructions template with {placeholders}
   *                               If omitted, auto-generates from inputParams (with schema descriptions if provided)
   *                               Example: "Character: {character}\nUser says: {userMessage}"
   * @param params.temperature - Optional temperature override (0-2, default from config)
   * @param params.history - Optional conversation history as role/content pairs
   * @param params.maxHistoryMessages - Optional limit on history size (default: unlimited)
   * @param params.maxTokens - Optional max tokens for response
   * @param params.timeout - Optional timeout in milliseconds
   * @param params.metadata - Optional metadata for LangSmith tracking
   * @param params.stopSequences - Optional stop sequences
   * @param params.validateInput - Optional flag to enable input validation (default: false)
   * @param params.tools - Optional array of tools to bind to the LLM
   * @param params.maxToolIterations - Optional max tool call iterations (default: 5)
   *
   * @returns Promise resolving to parsed output + token usage metadata
   * @throws {Error} If LLM call fails or returns invalid structured output
   *
   * @example Simple case (auto-generated instructions):
   * ```typescript
   * const response = await llm.call({
   *   inputParams: { character: {...}, userMessage: "Hello" },
   *   outputSchema: z.object({ response: z.string() }),
   *   systemPrompts: ["You are a helpful assistant"],
   *   // No instructions - auto-generates: "character: {...}\n\nuserMessage: Hello"
   * });
   * ```
   *
   * @example Custom instructions with placeholders:
   * ```typescript
   * const response = await llm.call({
   *   inputParams: {
   *     character: { name: "Zoe", description: "..." },
   *     userMessage: "Hello"
   *   },
   *   outputSchema: z.object({ response: z.string() }),
   *   systemPrompts: ["You are a helpful assistant"],
   *   instructions: "Character: {character}\nUser says: {userMessage}\nRespond in character:",
   *   temperature: 0.7,
   *   maxHistoryMessages: 20,
   *   metadata: { node_type: "character" },
   *   history: [
   *     { role: AgentMessageType.User, content: "Previous message" },
   *     { role: AgentMessageType.Assistant, content: "Previous response" }
   *   ]
   * });
   * ```
   */
  async call<T>(
    params: LLMCallParams<T>,
  ): Promise<T & { tokenUsage: { input: number; output: number }; modelWeight: ModelWeight }> {
    const modelWeight = params.modelWeight ?? ModelWeight.Normal;

    // MOCK_AI short-circuit: return synthetic structured output derived from the
    // output schema, with zero token usage and no provider call. Must run before
    // the cache lookup and any provider invocation. ModelService.onModuleInit
    // already guarantees MOCK_AI can never be on in production.
    if (this.config.get<ConfigAiInterface>("ai").mock) {
      return { ...mockFromZodSchema(params.outputSchema), tokenUsage: { input: 0, output: 0 }, modelWeight };
    }

    // Cache lookup BEFORE any provider invocation. A hit returns the stored
    // result immediately, skipping the provider call AND token persistence — a
    // cache hit costs nothing, which is the correct accounting. The key is
    // built from generic params only (modelWeight/temperature/systemPrompts +
    // a stable serialisation of inputParams as the prompt) to keep the cache
    // domain-agnostic.
    type CallResult = T & { tokenUsage: { input: number; output: number }; modelWeight: ModelWeight };
    let cacheKey: string | undefined;
    if (params.cacheable === true && this.cache) {
      cacheKey = buildCacheKey({
        modelWeight,
        temperature: params.temperature,
        systemPrompts: params.systemPrompts,
        prompt: JSON.stringify(params.inputParams),
      });
      const hit = await this.cache.get<CallResult>(cacheKey);
      if (hit !== null) return hit;
    }

    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature,
      costFn: (tokens) => this.tokenUsageService.computeCost({ tokens, modelWeight }),
    });
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;
    const parseFallbacks: Array<"tool_calls" | "lenient" | "raw"> = [];
    const warnings: string[] = [];
    // Bounded from here on: the request carries an abort signal, a watchdog
    // reports it while it is still open, and the deadline guarantees this
    // promise settles even if the provider never answers.
    const attemptTimeoutMs = this.attemptTimeoutMs(params.timeout);
    const label = `${(params.metadata?.nodeName as string) ?? "llm.call"}:${aiConfig.model}`;
    // The ordered fallback chain for this tier. Empty when no candidate-aware
    // ModelService is present; a single `.env` candidate when nothing is
    // configured in the database — in both cases the retry below is byte-for-byte
    // today's three attempts against one connection.
    const candidates = this.resolveCandidates(modelWeight);
    // Failover on 429/5xx walks the chain: at least today's 3 attempts, one per
    // candidate when the chain is longer, capped at 6 (spec § 2).
    const maxAttempts = Math.min(6, Math.max(TRANSIENT_RETRY_WAITS_MS.length + 1, candidates.length));
    // The candidate the SUCCESSFUL attempt used — it, not the first link of the
    // chain, is what the call is billed at.
    let servingCandidate: ResolvedAiCandidate | undefined = candidates[0];
    try {
      // The abort signal now comes from the retry wrapper, which owns a fresh
      // controller per attempt — a reused one would abort every retry instantly.
      const result = await this.runWithTransientRetry(
        label,
        attemptTimeoutMs,
        (signal, attempt) => {
          // Attempt n uses candidate n, clamped to the last one: a chain shorter
          // than the attempt budget keeps retrying its final link, which is the
          // `.env` block.
          const candidateIndex = candidates.length > 0 ? Math.min(attempt, candidates.length - 1) : undefined;
          if (candidateIndex !== undefined) servingCandidate = candidates[candidateIndex];
          return this._invokeOriginal<T>(
            params,
            session,
            (i, o, c) => {
              totalInput += i;
              totalOutput += o;
              totalCached += c;
            },
            (kind) => parseFallbacks.push(kind),
            (w) => warnings.push(w),
            { attemptTimeoutMs, signal, label, candidateIndex },
          );
        },
        {
          maxAttempts,
          // The candidate that just failed goes into cooldown, so the next
          // resolution — this call's next attempt included — skips it.
          onTransientFailure: (attempt) =>
            this.markCandidateFailure(candidates[Math.min(attempt, candidates.length - 1)]),
        },
      );
      session.close({
        finalStatus: "success",
        totalTokens: { input: totalInput, output: totalOutput, cached: totalCached },
        warnings,
        parseFallbacks,
      });
      await this.persistUsage(
        {
          tokenUsageType: params.tokenUsageType,
          relationshipId: params.relationshipId,
          relationshipType: params.relationshipType,
          modelWeight,
        },
        { input: totalInput, output: totalOutput, cached: totalCached },
        this.ratesForCandidate(servingCandidate),
      );
      const finalResult = { ...result, modelWeight };
      // Write-through on a miss so the next identical cacheable call hits.
      if (cacheKey && this.cache) await this.cache.set<CallResult>(cacheKey, finalResult);
      return finalResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
      session.close({
        finalStatus: "error",
        errorMessage: message,
        errorStack: stack,
        totalTokens: { input: totalInput, output: totalOutput, cached: totalCached },
        warnings,
        parseFallbacks,
      });
      // The provider charged for everything spent up to the failure — a timeout
      // mid tool-loop can burn six figures of input tokens, all of them already
      // reported through `addTokens` by the time we get here. Never throws, so
      // this cannot mask the original error.
      await this.persistUsageOnFailure(
        {
          tokenUsageType: params.tokenUsageType,
          relationshipId: params.relationshipId,
          relationshipType: params.relationshipType,
          modelWeight,
        },
        { input: totalInput, output: totalOutput, cached: totalCached },
        // Billed at the LAST candidate tried — the one whose failure ended the
        // call and whose provider charged for whatever it served.
        this.ratesForCandidate(servingCandidate),
      );
      console.error("[LLMService] Error calling LLM:", error);
      // The message text is load-bearing — callers match on "LLM service error:"
      // — so it stays byte-for-byte identical, and the original error rides along
      // as `cause`. Without it every network diagnosis stopped at this wrapper:
      // the ENOTFOUND / status / stack that explained the failure was thrown
      // away here. Assigned rather than passed as `new Error(msg, { cause })`
      // because this package targets ES2021, whose Error takes one argument.
      const wrapped = new Error(`LLM service error: ${message}`);
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    }
  }

  private async _invokeOriginal<T>(
    params: LLMCallParams<T>,
    session: DumpSession,
    addTokens: (input: number, output: number, cached: number) => void,
    addParseFallback: (kind: "tool_calls" | "lenient" | "raw") => void,
    addWarning: (msg: string) => void,
    // The per-attempt budget and the deadline's abort signal, supplied by
    // `call()`. Optional so direct callers (tests) keep working unbounded.
    // `label` is the SAME string the watchdog prints in `runBounded`, threaded
    // in so a reader can tie an iteration line to the `still pending` lines of
    // the very same call rather than guessing across two naming schemes.
    // `candidateIndex` selects which link of the tier's fallback chain builds the
    // model for THIS attempt; absent (direct callers, tests, no candidate-aware
    // ModelService) it resolves the first healthy candidate exactly as before.
    bounds?: { attemptTimeoutMs?: number; signal?: AbortSignal; label?: string; candidateIndex?: number },
  ): Promise<T & { tokenUsage: { input: number; output: number; cached?: number } }> {
    const label = bounds?.label ?? "llm.call";
    // Optional: Validate input parameters against schema
    if (params.inputSchema && params.validateInput) {
      try {
        params.inputParams = params.inputSchema.parse(params.inputParams);
      } catch (validationError) {
        console.error("[LLMService] Input validation failed:", validationError);
        throw new Error(
          `Invalid input parameters: ${validationError instanceof Error ? validationError.message : "Unknown validation error"}`,
        );
      }
    }

    // Create messages with modern MessagesPlaceholder pattern (with schema-guided instructions)
    const { template, historyMessages } = this._createMessages({
      systemPrompts: params.systemPrompts,
      instructions: params.instructions,
      inputParams: params.inputParams,
      inputSchema: params.inputSchema,
      history: params.history,
      maxHistoryMessages: params.maxHistoryMessages,
    });

    const prompt = ChatPromptTemplate.fromMessages(template);

    // Get base model. The per-attempt budget rides on the model itself: the
    // OpenAI client is built with it, so each attempt aborts on schedule and the
    // LangChain retry re-issues (escalating the OpenRouter pin) instead of the
    // whole call sitting on one dead socket.
    const baseModel = this.modelService.getLLM({
      temperature: params.temperature,
      modelWeight: params.modelWeight,
      disableThinking: params.disableThinking,
      reasoningEffort: params.reasoningEffort,
      timeoutMs: bounds?.attemptTimeoutMs ?? params.timeout,
      // Spread rather than always passed: without a chain the argument object
      // stays exactly the one every existing caller already built.
      ...(bounds?.candidateIndex !== undefined ? { candidateIndex: bounds.candidateIndex } : {}),
    });

    // Build config options for the invocation
    const configOptions: Record<string, any> = {};
    if (params.maxTokens) {
      // Per-call output cap under BOTH provider conventions: LangChain's
      // OpenAI-compatible clients honour `maxTokens` in call options, the
      // Google/Vertex client only reads `maxOutputTokens` — passing one name
      // silently no-ops on the other provider.
      configOptions.maxTokens = params.maxTokens;
      configOptions.maxOutputTokens = params.maxTokens;
    }
    if (params.stopSequences) configOptions.stop = params.stopSequences;
    if (params.metadata) configOptions.metadata = params.metadata;
    if (params.timeout) configOptions.timeout = params.timeout;
    // The deadline's signal — aborting it releases the in-flight request rather
    // than leaving an orphaned socket behind a rejected promise.
    if (bounds?.signal) configOptions.signal = bounds.signal;

    // Track token usage across tool iterations
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    // Declared at method scope so the end-of-call summary compiles — and reports
    // an honest 0 — on the non-tool path too.
    let iterationsUsed = 0;
    let failedToolCalls = 0;

    // Build initial messages for the conversation
    const conversationMessages: BaseMessage[] = await prompt.formatMessages({
      ...params.inputParams,
      chat_history: historyMessages,
    });

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions:
        params.instructions ?? this._generateSchemaGuidedInstructions(params.inputParams, params.inputSchema),
      inputParams: params.inputParams,
      history: (params.history ?? []).map((h) => ({ role: String(h.role), content: h.content })),
      tools: (params.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        schema: (t as any).schema,
      })),
      outputSchemaName: (params.outputSchema as any)?.constructor?.name ?? "outputSchema",
    });

    // If tools are provided, handle tool calling loop
    if (params.tools && params.tools.length > 0) {
      const maxIterations = params.maxToolIterations ?? 5;

      // Build tool map for execution
      const toolMap = new Map<string, DynamicStructuredTool>();
      for (const tool of params.tools) {
        toolMap.set(tool.name, tool);
      }

      // Bind tools to model
      const modelWithTools = baseModel.bindTools(params.tools);

      // Signature → consecutive rejections. A model that cannot fix a malformed
      // call re-emits it verbatim; without this it does so until the iteration
      // budget is gone.
      const failureStreaks = new Map<string, number>();
      let abandonToolLoop = false;

      // Tool calling loop
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        session.startIteration("tool-loop", conversationMessages);
        iterationsUsed++;
        const iterationStartedAt = Date.now();
        // Call model with tools
        let toolResponse: Awaited<ReturnType<typeof modelWithTools.invoke>>;
        try {
          toolResponse =
            Object.keys(configOptions).length > 0
              ? await modelWithTools.invoke(conversationMessages, configOptions)
              : await modelWithTools.invoke(conversationMessages);
        } catch (error) {
          throw LLMService.normaliseEmptyResponseError(error);
        }

        session.recordResponse({
          content: typeof (toolResponse as any).content === "string" ? (toolResponse as any).content : "",
          toolCalls: ((toolResponse as AIMessage).tool_calls ?? []).map((c) => ({
            id: c.id ?? "",
            name: c.name,
            args: c.args,
          })),
          tokenUsage: {
            input: (toolResponse as unknown as LLMRawResponse).usage_metadata?.input_tokens ?? 0,
            output: (toolResponse as unknown as LLMRawResponse).usage_metadata?.output_tokens ?? 0,
          },
          finishReason: (toolResponse as unknown as LLMRawResponse).response_metadata?.finish_reason,
        });

        // One line per iteration, so a slow agentic call is diagnosable from the
        // log alone: which iteration burned the time, how much of its output was
        // hidden reasoning, and which tools it asked for.
        const iterationUsage = (toolResponse as unknown as LLMRawResponse).usage_metadata;
        const requestedTools = ((toolResponse as AIMessage).tool_calls ?? []).map((c) => c.name);
        this.logger.log(
          `[${label}] tool-loop iteration ${iteration + 1}/${maxIterations} ` +
            `took ${Math.round((Date.now() - iterationStartedAt) / 1000)}s ` +
            `in=${iterationUsage?.input_tokens ?? 0} out=${iterationUsage?.output_tokens ?? 0} ` +
            `reasoning=${iterationUsage?.output_token_details?.reasoning ?? 0} ` +
            `tools=[${requestedTools.join(",") || "none"}]`,
        );

        // Track token usage. Reported to the caller AS IT IS SPENT, not at the
        // end: this iteration is already billed by the provider, and a later
        // failure (a timeout on the final structured call, an unparseable
        // answer) must not make those tokens disappear from `call()`'s totals.
        // The final return therefore adds only ITS OWN delta — see `addTokens`
        // at the return sites below.
        const responseUsage = (toolResponse as unknown as LLMRawResponse).usage_metadata;
        if (responseUsage) {
          const iterationInput = responseUsage.input_tokens ?? 0;
          const iterationOutput = responseUsage.output_tokens ?? 0;
          const iterationCached = responseUsage.input_token_details?.cache_read ?? 0;
          totalInputTokens += iterationInput;
          totalOutputTokens += iterationOutput;
          totalCachedTokens += iterationCached;
          addTokens(iterationInput, iterationOutput, iterationCached);
        }

        // Check for tool calls
        const toolCalls = (toolResponse as AIMessage).tool_calls ?? [];

        if (toolCalls.length === 0) {
          // No more tool calls — the model has answered in prose. That answer is
          // already generated and already billed, so KEEP it: pushed into the
          // conversation it becomes the draft the final structured call
          // restructures, instead of context the model has to re-derive from the
          // tool results alone.
          //
          // It used to be dropped here. Measured on a legal-research run, that
          // discarded 20,943 output tokens across 8 iterations — every one of them
          // a complete answer the next call then regenerated from scratch.
          conversationMessages.push(toolResponse);
          break;
        }

        // Add AI message with tool calls to conversation
        conversationMessages.push(toolResponse);

        // Execute each tool call
        for (const toolCall of toolCalls) {
          const tool = toolMap.get(toolCall.name);

          if (!tool) {
            console.warn(`[LLMService] Tool not found: ${toolCall.name}`);
            // Name the valid tools in the reply: a bare "not found" is too weak
            // a signal for small models, which just retry the same wrong name.
            const notFound = `Tool "${toolCall.name}" does not exist. Use EXACTLY one of: ${[...toolMap.keys()].join(", ")}`;
            conversationMessages.push(
              new ToolMessage({
                content: notFound,
                tool_call_id: toolCall.id ?? "",
              }),
            );
            session.recordToolResult(toolCall.id ?? "", toolCall.name, notFound);
            continue;
          }

          try {
            const result = await tool.invoke(toolCall.args);
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            conversationMessages.push(
              new ToolMessage({
                content: resultStr,
                tool_call_id: toolCall.id ?? "",
              }),
            );
            session.recordToolResult(toolCall.id ?? "", toolCall.name, resultStr);
            // A success clears the streak: the model is making progress again.
            failureStreaks.delete(toolCallSignature(toolCall.name, toolCall.args));
          } catch (error) {
            failedToolCalls++;
            console.error(`[LLMService] Tool error: ${toolCall.name}`, error);

            const signature = toolCallSignature(toolCall.name, toolCall.args);
            const attempts = (failureStreaks.get(signature) ?? 0) + 1;
            failureStreaks.set(signature, attempts);

            // Schema rejections happen inside LangChain, before the tool's own
            // code runs, so the model only ever sees a generic "did not match
            // expected schema". Replace it with the actionable version.
            const rejection = describeToolInputRejection({
              toolName: toolCall.name,
              schema: (tool as unknown as { schema?: unknown }).schema,
              args: toolCall.args,
            });

            const givingUp = attempts >= REPEATED_TOOL_FAILURE_LIMIT;
            if (givingUp) {
              // The same rejected call keeps coming back; further iterations
              // would only reprice the same mistake. Finish answering the tool
              // calls in this batch, then leave the loop.
              abandonToolLoop = true;
              this.logger.warn(
                `[${label}] abandoning tool loop: "${toolCall.name}" rejected ${attempts}x with identical arguments`,
              );
            }

            const content = givingUp
              ? repeatedToolFailureMessage({ toolName: toolCall.name, attempts })
              : (rejection ?? `Tool error: ${error instanceof Error ? error.message : "Unknown error"}`);

            conversationMessages.push(
              new ToolMessage({
                content,
                tool_call_id: toolCall.id ?? "",
              }),
            );
            session.recordToolResult(toolCall.id ?? "", toolCall.name, content);
          }
        }

        if (abandonToolLoop) break;
      }
    }

    // Nudge the model out of tool-use mode before asking for the final structured
    // answer. Without this, some models (notably gpt-oss) emit another tool_calls
    // response instead of producing the structured output, and parsing fails with
    // "No content" / finish_reason=tool_calls. The nudge is only appended when the
    // tool-calling loop ran at all.
    if (params.tools && params.tools.length > 0 && conversationMessages.length > 0) {
      conversationMessages.push(
        new HumanMessage(
          "You have gathered enough information from the tool calls above to answer the user's question. Produce your final answer now as the structured output the system expects. Do not request any further tool calls.",
        ),
      );
    }

    // Get final structured response (unified path for both tool and non-tool flows)
    // For Requesty + Gemini: sanitize schema to remove $schema, $defs, etc. that Gemini rejects.
    // Resolve against the same weight getLLM used, so lite/large Gemini models are detected correctly.
    const aiConfig = this.modelService.getResolvedConfig(params.modelWeight);
    // Check if model is Gemini (handles both "gemini-..." and "google/gemini-..." formats)
    const modelLower = aiConfig.model.toLowerCase();
    const isGeminiModel = modelLower.startsWith("gemini") || modelLower.includes("/gemini");
    const needsGeminiSanitization = aiConfig.provider === "requesty" && isGeminiModel;

    let structuredLlm;
    // Set only when the schema had to be rewritten for strict mode. It is the schema
    // BEFORE rewriting, and therefore the source of truth for which nulls the model was
    // forced to emit — see `normaliseStrictOutput` below.
    let originalJsonSchema: any | undefined;
    if (needsGeminiSanitization) {
      // Convert Zod to JSON Schema and remove Gemini-incompatible properties
      const jsonSchema = convertZodToJsonSchema(params.outputSchema);
      const sanitizedSchema = sanitizeSchemaForGemini(jsonSchema);
      structuredLlm = baseModel.withStructuredOutput(sanitizedSchema, {
        includeRaw: true,
      });
    } else if (!this.modelService.supportsStrictStructuredOutput(params.modelWeight)) {
      // This provider ignores `strict` (see ModelService.supportsStrictStructuredOutput).
      // Rewriting would force a null for every optional field and buy no guarantee,
      // so hand the Zod schema over untouched and let LangChain validate.
      structuredLlm = baseModel.withStructuredOutput(params.outputSchema, { includeRaw: true });
    } else {
      // LangChain hands any Zod schema to `interopZodResponseFormat`, which hardcodes
      // `strict: true` (passing `strict: false` is ignored). Strict mode demands that
      // every property appear in `required`, which `.optional()` schemas — most of ours
      // — do not satisfy, so the provider rejects the request outright.
      //
      // Strict mode is the only path that GUARANTEES the payload matches the schema:
      // measured against live gpt-5-nano, the tool-calling alternative returned a bare
      // string where the schema declared `assumptions: string[]` in about half of all
      // runs. So satisfy strict rather than abandon it — but an open record (`z.record`)
      // has no fixed properties to require and CANNOT be made strict-compatible. Those
      // fall through to tool calling, which imposes no schema rules and still validates
      // through Zod. All three branches are decided by the schema, never a model name.
      const original = convertZodToDraftJsonSchema(params.outputSchema);
      if (isStrictStructuredOutputCompatible(original)) {
        // The Zod schema is handed to LangChain, whose zod-v4 interop converts it with
        // `reused: "ref"`. CAUTION for schema authors: a field chaining metadata onto a
        // wrapper — `.default(...).describe(...)`, describe LAST — makes that interop
        // emit `{ $ref, default, description, title }`, which OpenAI strict mode
        // rejects ("$ref cannot have keywords ...", observed live against Azure
        // gpt-5-nano). Chain `.describe(...)` on the inner type BEFORE `.default(...)`
        // and the conversion stays inline and valid.
        structuredLlm = baseModel.withStructuredOutput(params.outputSchema, { includeRaw: true });
      } else {
        const rewritten = makeSchemaStrictCompatible(original);
        if (isStrictStructuredOutputCompatible(rewritten)) {
          originalJsonSchema = original;
          structuredLlm = baseModel.withStructuredOutput(rewritten, { includeRaw: true, strict: true });
        } else {
          structuredLlm = baseModel.withStructuredOutput(params.outputSchema, {
            includeRaw: true,
            method: "functionCalling" as const,
          });
        }
      }
    }

    session.startIteration("final-structured", conversationMessages);

    // A timed-out attempt is RE-ISSUED ONCE on the same model instance, because
    // that is what actually recovers a stall: the instance's
    // `openRouterEscalatingFetch` closure escalates on its second request, so
    // the retry allows fallbacks and OpenRouter reroutes off the provider that
    // went quiet. (This is precisely how the 639s stall eventually resolved —
    // the SDK's 600s abort, then a rerouted retry that answered in 39s. Here it
    // happens after the attempt budget instead of after ten minutes.)
    //
    // A fresh call would NOT get this: `getLLM` builds a new instance per call,
    // resetting the escalation, so a hard-pinned tier would retry straight back
    // onto the stalled provider. An abort is the ONLY thing retried here —
    // provider errors and parse failures stay the caller's business.
    const invokeStructured = async (): Promise<StructuredOutputResponse<T>> => {
      try {
        return (await structuredLlm.invoke(
          conversationMessages,
          Object.keys(configOptions).length > 0 ? configOptions : undefined,
        )) as unknown as StructuredOutputResponse<T>;
      } catch (error) {
        // Empty-candidates crash → clear retryable error; never a timeout, so
        // the reroute logic below is unaffected.
        throw LLMService.normaliseEmptyResponseError(error);
      }
    };

    let response: StructuredOutputResponse<T>;
    try {
      response = await invokeStructured();
    } catch (error) {
      // The deadline's own abort is NOT a stall to reroute around — it means the
      // whole call is over, so let it through.
      if (!isTimeoutError(error) || bounds?.signal?.aborted) throw error;
      const msg = `[LLMService] attempt timed out after ${Math.round((bounds?.attemptTimeoutMs ?? 0) / 1000)}s — re-issuing with provider fallbacks escalated`;
      console.warn(msg);
      addWarning(msg);
      response = await invokeStructured();
    }

    // Extract token usage with type guard (includes tool iteration tokens)
    const raw = isValidRaw(response.raw) ? response.raw : undefined;

    /**
     * Undoes the strict-mode rewrite. Strict mode cannot omit a key, so every
     * originally-optional field came back explicitly null; dropping those nulls
     * restores absence, which is what `.optional()` expects and what `.default()`
     * needs in order to apply. A no-op when the schema went through unrewritten.
     */
    const normaliseStrictOutput = (value: any): any =>
      originalJsonSchema ? stripSyntheticNulls(value, originalJsonSchema) : value;

    session.recordResponse({
      content: typeof raw?.content === "string" ? raw.content : "",
      tokenUsage: {
        input: raw?.usage_metadata?.input_tokens ?? 0,
        output: raw?.usage_metadata?.output_tokens ?? 0,
      },
      finishReason: raw?.response_metadata?.finish_reason,
    });
    // The final structured response's OWN usage. Reported separately from the
    // totals because the tool loop has already handed its share to `addTokens`;
    // re-reporting the sum would bill every tool iteration twice.
    const finalInput = raw?.usage_metadata?.input_tokens ?? 0;
    const finalOutput = raw?.usage_metadata?.output_tokens ?? 0;
    const finalCached = raw?.usage_metadata?.input_token_details?.cache_read ?? 0;
    const input = totalInputTokens + finalInput;
    const output = totalOutputTokens + finalOutput;
    const cached = totalCachedTokens + finalCached;

    /**
     * One summary line per completed call, emitted at EVERY return site — the
     * degraded runs are the ones worth diagnosing, so a fallback-parsed call must
     * not be the silent one. `outcome` names the path taken: "clean" is the
     * provider honouring the structured-output contract, anything else means the
     * declared schema came back unparseable and was salvaged.
     */
    const logCallSummary = (
      outcome: "clean" | "fallback:tool_calls" | "fallback:lenient" | "fallback:raw" | "fallback:truncation-repair",
    ) => {
      this.logger.log(
        `[${label}] complete (${outcome}): ${iterationsUsed} tool iteration(s), ${failedToolCalls} failed tool call(s), ` +
          `in=${input} out=${output} cached=${cached} ` +
          `reasoning=${raw?.usage_metadata?.output_token_details?.reasoning ?? 0}`,
      );
    };

    /**
     * The salvage ladder — tool_calls → lenient tool_calls → raw content — run
     * whenever the declared schema did not come back cleanly.
     *
     * Shared by BOTH failure paths on purpose. LangChain returning no parsed value
     * is the obvious one; the subtler one is the rewritten-strict branch, where
     * LangChain parses a raw JSON Schema with a lenient `JsonOutputParser` that
     * happily "succeeds" on a truncated or markdown-fenced payload. Such a value is
     * only rejected when it meets the caller's Zod schema, which happens AFTER the
     * `response.parsed` check — so without this being reachable from there, a
     * `finish_reason: "length"` truncation would throw a bare `ZodError`, skip every
     * fallback, and still have been logged as a clean call.
     *
     * Neither `logCallSummary` nor `addTokens` runs before this: the outcome is not
     * known until the ladder settles, and a degraded run must not be recorded as clean.
     */
    const salvageParse = (): T & { tokenUsage: { input: number; output: number; cached: number } } => {
      const rawContent = raw?.content || "No content";
      const finishReason = raw?.response_metadata?.finish_reason;

      console.error("[LLMService] Parsing failed:", {
        rawContentPreview: rawContent.substring(0, 500),
        finishReason,
        schemaName: params.outputSchema.constructor.name,
      });

      // Attempt fallback parsing from tool_calls first (Azure/OpenAI function calling puts structured data here)
      const rawAnyFallback = raw as any;
      const toolCallArgs = rawAnyFallback?.tool_calls?.[0]?.args;
      if (toolCallArgs && typeof toolCallArgs === "object") {
        addParseFallback("tool_calls");
        try {
          console.warn("[LLMService] Attempting fallback parsing from tool_calls args");
          const validated = params.outputSchema.parse(normaliseStrictOutput(toolCallArgs));

          console.warn("[LLMService] Fallback tool_calls parsing succeeded");

          logCallSummary("fallback:tool_calls");
          addTokens(finalInput, finalOutput, finalCached);
          return {
            ...(validated as T),
            tokenUsage: { input, output, cached },
          };
        } catch (_toolCallFallbackError) {
          // Lenient fallback: filter out malformed array entries from tool_calls args
          // This handles cases where the model returns mostly valid data with a few corrupt entries
          addParseFallback("lenient");
          try {
            console.warn("[LLMService] Attempting lenient tool_calls parsing (filtering invalid array entries)");
            const cleanedArgs = { ...normaliseStrictOutput(toolCallArgs) };
            const shape = (params.outputSchema as any)?.shape;

            if (shape) {
              for (const [key, fieldSchema] of Object.entries(shape)) {
                if (Array.isArray(cleanedArgs[key])) {
                  // In Zod v4, ZodArray exposes .element as the element schema with .safeParse()
                  // Unwrap optional/default/nullable wrappers first if present
                  let schema = fieldSchema as any;
                  while (schema?.unwrap && !schema?.element) {
                    schema = schema.unwrap();
                  }
                  const elementSchema = schema?.element;

                  if (elementSchema && typeof elementSchema.safeParse === "function") {
                    const original = cleanedArgs[key];
                    cleanedArgs[key] = original.filter((entry: any) => elementSchema.safeParse(entry).success);
                    if (cleanedArgs[key].length < original.length) {
                      console.warn(
                        `[LLMService] Filtered ${original.length - cleanedArgs[key].length}/${original.length} invalid entries from "${key}"`,
                      );
                    }
                  }
                }
              }
            }

            const validated = params.outputSchema.parse(cleanedArgs);
            console.warn("[LLMService] Lenient tool_calls parsing succeeded");

            logCallSummary("fallback:lenient");
            addTokens(finalInput, finalOutput, finalCached);
            return {
              ...(validated as T),
              tokenUsage: { input, output, cached },
            };
          } catch {
            // Fall through to raw content parsing
          }
        }
      }

      // Attempt fallback parsing from raw content
      addParseFallback("raw");
      try {
        console.warn("[LLMService] Attempting fallback JSON parsing");
        const manualParse = JSON.parse(rawContent);
        const validated = params.outputSchema.parse(normaliseStrictOutput(manualParse));

        console.warn("[LLMService] Fallback parsing succeeded");

        logCallSummary("fallback:raw");
        addTokens(finalInput, finalOutput, finalCached);
        return {
          ...(validated as T),
          tokenUsage: { input, output, cached },
        };
      } catch (fallbackError) {
        // Last rung. A MAX_TOKENS truncation (`finish_reason: "length"`) stops
        // the payload mid-value, so every rung above — all of which need the
        // whole document to parse — rejects a response whose completed elements
        // were perfectly good. Trim to the last complete value, close the open
        // containers, and validate exactly as the raw rung does.
        const repaired = repairTruncatedJson(rawContent);
        if (repaired !== null) {
          try {
            const validated = params.outputSchema.parse(normaliseStrictOutput(JSON.parse(repaired)));
            this.logger.warn(
              `[${label}] parseFallback: "truncation-repair" — recovered a truncated payload ` +
                `(finishReason=${finishReason}, ${rawContent.length}→${repaired.length} chars)`,
            );
            logCallSummary("fallback:truncation-repair");
            addTokens(finalInput, finalOutput, finalCached);
            return {
              ...(validated as T),
              tokenUsage: { input, output, cached },
            };
          } catch {
            // Repaired text still does not satisfy the schema — fall through to
            // the diagnostic below, which reports the ORIGINAL failure.
          }
        }
        // Every salvage attempt failed, so this call is about to throw — but the
        // unparseable answer was generated and billed like any other. Report it
        // before unwinding, so `call()`'s catch can record it. No return site
        // follows this one, so nothing is counted twice.
        addTokens(finalInput, finalOutput, finalCached);
        throw new Error(
          `LLM failed to return structured output. ` +
            `Finish reason: ${finishReason}. ` +
            `Raw content preview: ${rawContent.substring(0, 200)}...` +
            `Fallback parsing error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
      }
    };

    // Enhanced error handling with detailed diagnostics
    if (!response.parsed) return salvageParse();

    let result: T;
    try {
      // A rewritten schema was sent as raw JSON Schema, so LangChain parsed it with a
      // plain JSON parser and did NO Zod validation — strip the synthetic nulls and
      // validate here, so this path returns exactly what the Zod-schema path returns.
      result = originalJsonSchema
        ? (params.outputSchema.parse(normaliseStrictOutput(response.parsed)) as T)
        : (response.parsed as T);
    } catch (strictValidationError) {
      // A lenient parser said yes and the declared schema said no — a truncated or
      // partial payload, not a clean call. Take the same ladder the no-parsed-value
      // path takes, so the caller gets the descriptive diagnostic instead of a bare
      // ZodError, and the summary line reports the outcome that actually happened.
      console.warn(
        `[LLMService] structured output parsed but failed schema validation — entering fallback ladder: ` +
          `${strictValidationError instanceof Error ? strictValidationError.message : String(strictValidationError)}`,
      );
      return salvageParse();
    }

    logCallSummary("clean");
    addTokens(finalInput, finalOutput, finalCached);
    return {
      ...result,
      tokenUsage: {
        input,
        output,
        cached,
      },
    };
  }

  /**
   * Streaming variant of {@link call}. Same structured-input/structured-output
   * contract — uses `outputSchema` (Zod) for enforced structured output and
   * `inputSchema` for schema-guided instructions — but yields the LLM's
   * response progressively as it generates.
   *
   * Returns two handles:
   *   - `textStream` — raw JSON-text fragments as the LLM builds the object.
   *     Useful for forwarding to clients that incrementally parse JSON (e.g.
   *     BlockNote AI's UIMessageStream consumer). MUST be consumed (even if
   *     just to drain) for `result` to resolve — `streamObject` only commits
   *     the final object after the source stream is fully read.
   *   - `result` — Promise that resolves to the final fully-parsed structured
   *     output + token usage, once the stream completes. Equivalent to what
   *     `call` returns.
   *
   * Returns `partialObjectStream` (not `textStream`): each iteration yields
   * the cumulative best-effort parse of the output object as it grows. For a
   * schema like `z.object({ paragraph: z.string() })`, consumers see
   * `{paragraph: undefined}` → `{paragraph: "Jam"}` → `{paragraph: "James"}`
   * etc., letting them extract field-value deltas without parsing raw JSON
   * tokens themselves.
   *
   * Note: only one stream view is exposed because `streamObject`'s
   * `textStream` / `partialObjectStream` / `fullStream` getters all consume
   * the same underlying source — accessing two of them locks the source on
   * the first and throws on the second. For consumers that want raw JSON
   * text fragments instead, add a separate variant.
   *
   * Implementation note: uses Vercel AI SDK's `streamObject` under the hood
   * because LangChain's `withStructuredOutput().stream()` only yields parsed
   * partials — not the raw JSON text fragments that downstream UI-message
   * consumers (BlockNote AI, the AI SDK's own React hooks, etc.) need to
   * apply changes incrementally. `call` stays on LangChain for non-streaming
   * structured output — both paths share `_generateSchemaGuidedInstructions`
   * for input formatting and the `LLMCallDumper` session for cost tracking.
   *
   * Provider support: currently OpenAI-compatible only (llamacpp, openrouter,
   * requesty, plus any other provider exposed via an OpenAI-compatible URL).
   * Throws for vertex/azure with native (non-OpenAI-compat) configurations.
   * Extend via new `@ai-sdk/*` provider adapters when needed.
   */
  async streamCall<T extends Record<string, any>>(
    params: LLMCallParams<T>,
  ): Promise<{
    partialObjectStream: AsyncIterable<Partial<T>>;
    result: Promise<T & { tokenUsage: { input: number; output: number }; modelWeight: ModelWeight }>;
  }> {
    const modelWeight = params.modelWeight ?? ModelWeight.Normal;
    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature,
      costFn: (tokens) => this.tokenUsageService.computeCost({ tokens, modelWeight }),
    });

    // Build the same schema-guided instruction string `call` would build, so
    // structured input semantics (field descriptions from `inputSchema`) flow
    // through identically. If the caller passed explicit `instructions` with
    // {placeholders}, substitute them from `inputParams` (mimicking
    // ChatPromptTemplate's behavior without dragging in the LangChain runtime).
    let finalInstructions =
      params.instructions || this._generateSchemaGuidedInstructions(params.inputParams, params.inputSchema);
    if (params.instructions && params.inputParams) {
      for (const [key, value] of Object.entries(params.inputParams)) {
        const placeholder = `{${key}}`;
        if (!finalInstructions.includes(placeholder)) continue;
        const formatted = typeof value === "string" ? value : JSON.stringify(value);
        finalInstructions = finalInstructions.split(placeholder).join(formatted);
      }
    }

    const system = params.systemPrompts.join("\n\n");

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions: finalInstructions,
      inputParams: params.inputParams,
      history: [],
      tools: [],
      outputSchemaName: (params.outputSchema as any)?.constructor?.name ?? "outputSchema",
    });

    // Map narr8 provider → Vercel AI SDK provider adapter. v1 supports
    // OpenAI-compatible providers only; extend with new `@ai-sdk/*` packages
    // (e.g. `@ai-sdk/google-vertex`, `@ai-sdk/azure`) when narr8 starts using
    // a non-OpenAI-compat path with streamCall.
    const openaiCompatProviders = new Set(["llamacpp", "local", "openrouter", "requesty"]);
    if (!openaiCompatProviders.has(aiConfig.provider) && aiConfig.url) {
      // If the configured `url` exists, treat as OpenAI-compatible by default —
      // most narr8 setups route through an OpenAI-compatible endpoint even for
      // azure/vertex via custom URLs.
    } else if (!openaiCompatProviders.has(aiConfig.provider)) {
      session.close({
        finalStatus: "error",
        errorMessage: `streamCall does not yet support provider "${aiConfig.provider}"`,
        totalTokens: { input: 0, output: 0 },
        warnings: [],
        parseFallbacks: [],
      });
      throw new Error(
        `LLMService.streamCall: provider "${aiConfig.provider}" not supported. ` +
          `Add a Vercel AI SDK adapter to LLMService.streamCall or use an OpenAI-compatible URL.`,
      );
    }

    // `strict: true` is the only mode that GUARANTEES the payload matches the
    // schema, but it demands every property be required with
    // `additionalProperties: false`. Schemas carrying `.optional()` fields or
    // open records cannot satisfy that and the provider rejects the request
    // outright, so mirror `call`'s decision and ask for strict only when the
    // schema already qualifies. Non-strict still ships the schema — as guidance
    // rather than constrained decoding.
    const strictJsonSchema = isStrictStructuredOutputCompatible(convertZodToDraftJsonSchema(params.outputSchema));

    const providerOptionsKey = aiConfig.provider || "narr8";
    const provider = createOpenAICompatible({
      name: providerOptionsKey,
      apiKey: aiConfig.apiKey,
      baseURL: aiConfig.url,
      // Send the output schema as `response_format.json_schema`. WITHOUT this
      // the SDK silently degrades every structured request to
      // `{ type: "json_object" }` and DROPS the schema: the model is told to
      // emit "some JSON" with no shape at all, and OpenAI/Azure reject the call
      // outright — "Response input messages must contain the word 'json' in
      // some form to use 'text.format' of type 'json_object'" — unless the
      // prompt happens to contain that word. Gemini tolerated the degraded
      // form; gpt-5.x does not. The non-streaming `call` path has always sent
      // json_schema (LangChain's `withStructuredOutput`), so every provider
      // reachable from here already supports it.
      supportsStructuredOutputs: true,
      // Pin OpenRouter routing on the streaming path too (the LangChain path
      // pins via modelKwargs; this SDK builds its own model). Without it the
      // stream is unpinned and can be moderated by a misrouted provider.
      ...(aiConfig.provider === "openrouter" && aiConfig.region
        ? { fetch: openRouterEscalatingFetch(aiConfig.region, aiConfig.allowFallbacks ?? true) }
        : {}),
    });
    const model = provider.chatModel(aiConfig.model);

    // Reuse the "final-structured" iteration kind — semantically this IS the
    // final-structured response, just streamed instead of awaited atomically.
    // Avoids widening the dumper's union type for a single call site.
    session.startIteration("final-structured", []);

    const attemptTimeoutMs = this.attemptTimeoutMs(params.timeout);
    const label = `${(params.metadata?.nodeName as string) ?? "llm.streamCall"}:${aiConfig.model}`;

    // One attempt = one abort controller + one whole-stream timeout, so a hung
    // connection can't pin the session open indefinitely. The bound is NOT
    // `runWithTransientRetry`'s per-attempt deadline: a stream outlives its
    // first byte, so its timer must stay armed until the stream finishes.
    //
    // Schema cast: `streamObject`'s typing is a conditional union over the
    // output mode (`object` / `enum` / `array` / `no-schema`). Our T is always
    // a Zod object schema; the runtime call is correct.
    const startAttempt = () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);
      timeoutId.unref?.();
      return {
        controller,
        timeoutId,
        handle: streamObject({
          model,
          schema: params.outputSchema as any,
          system,
          prompt: finalInstructions,
          providerOptions: { [providerOptionsKey]: { strictJsonSchema } },
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
          maxRetries: 2,
          abortSignal: controller.signal,
        }),
      };
    };
    let attempt = startAttempt();
    // Set the instant the caller starts reading the stream. Past that point a
    // restart would REPLAY output the consumer has already seen, so the
    // transient retry below only ever fires while the consumer is still idle —
    // which is precisely the window in which a DNS/connect failure lands.
    let consumerStarted = false;

    // Build the result Promise that closes the session once the stream finishes.
    // This is awaitable independently of consuming the streams — `streamObject`
    // internally tees the source, so consuming `textStream` (or not) doesn't
    // affect `result` resolution.
    const resultPromise: Promise<T & { tokenUsage: { input: number; output: number }; modelWeight: ModelWeight }> =
      (async () => {
        for (let retry = 0; ; retry++) {
          try {
            const finalObject = (await attempt.handle.object) as T;
            const usage = await attempt.handle.usage;
            const input = usage?.inputTokens ?? 0;
            const output = usage?.outputTokens ?? 0;
            const cached = usage?.inputTokenDetails?.cacheReadTokens ?? 0;

            session.recordResponse({
              content: JSON.stringify(finalObject),
              tokenUsage: { input, output },
              finishReason: String(await attempt.handle.finishReason),
            });
            session.close({
              finalStatus: "success",
              totalTokens: { input, output, cached },
              warnings: [],
              parseFallbacks: [],
            });
            clearTimeout(attempt.timeoutId);
            await this.persistUsage(
              {
                tokenUsageType: params.tokenUsageType,
                relationshipId: params.relationshipId,
                relationshipType: params.relationshipType,
                modelWeight,
              },
              { input, output, cached },
            );

            return { ...(finalObject as any), tokenUsage: { input, output }, modelWeight };
          } catch (error) {
            // Restartable only while nothing has been delivered — see
            // `consumerStarted`.
            if (!consumerStarted && retry < TRANSIENT_RETRY_WAITS_MS.length && this.isTransientNetworkError(error)) {
              clearTimeout(attempt.timeoutId);
              attempt.controller.abort();
              await this.waitBeforeTransientRetry(label, retry, error);
              attempt = startAttempt();
              continue;
            }
            clearTimeout(attempt.timeoutId);
            const message = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
            // `streamObject` may have settled `usage` even though `object`
            // rejected (a schema-invalid payload is still a billed generation).
            // Read it defensively so the session and the ledger report the real
            // figures instead of the hard-coded 0/0 this used to close with.
            // Bounded: this promise has no outer deadline, so a `usage` that never
            // settles must not stop `result` from rejecting (see readUsageBounded).
            const usage = await this.readUsageBounded(attempt.handle.usage);
            const input = usage?.inputTokens ?? 0;
            const output = usage?.outputTokens ?? 0;
            const cached = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
            session.close({
              finalStatus: "error",
              errorMessage: message,
              errorStack: stack,
              totalTokens: { input, output, cached },
              warnings: [],
              parseFallbacks: [],
            });
            await this.persistUsageOnFailure(
              {
                tokenUsageType: params.tokenUsageType,
                relationshipId: params.relationshipId,
                relationshipType: params.relationshipType,
                modelWeight,
              },
              { input, output, cached },
            );
            console.error("[LLMService.streamCall] Error:", error);
            const wrapped = new Error(`LLM streamCall error: ${message}`);
            (wrapped as Error & { cause?: unknown }).cause = error;
            throw wrapped;
          }
        }
      })();

    // Surface (don't swallow) a rejected result even when the caller never
    // awaits `result` — e.g. on abort/timeout or an unreachable provider.
    resultPromise.catch((err) => this.logger.warn(`streamCall result rejected: ${String(err)}`));

    // Wrapped rather than handed over directly so that (a) the consumer's first
    // pull marks the stream unrestartable, and (b) the `partialObjectStream`
    // getter — one of three getters that lock the source on first access — is
    // touched only if the consumer actually reads, and on whichever attempt
    // finally connected.
    async function* partialObjects(): AsyncGenerator<Partial<T>> {
      consumerStarted = true;
      for await (const partial of attempt.handle.partialObjectStream) yield partial as Partial<T>;
    }

    return {
      partialObjectStream: partialObjects(),
      result: resultPromise,
    };
  }

  /**
   * Plain-text streaming variant of {@link streamCall}. Unlike `streamCall`
   * (which enforces a Zod `outputSchema` via `streamObject` and therefore
   * requires the model/provider to support structured/JSON output), this method
   * streams free-form text via the Vercel AI SDK's `streamText`.
   *
   * Use this when:
   *   - The desired output is just prose (no structured object), AND/OR
   *   - The provider/model does not support JSON response formats
   *     (e.g. Ollama with many local models), where `streamObject` fails with
   *     `NoObjectGeneratedError` because the model returns prose, not JSON.
   *
   * Returns two handles:
   *   - `fullStream` — normalized incremental parts as the model generates them:
   *     `{ type: "text", delta }` for answer content and `{ type: "reasoning",
   *     delta }` for a reasoning/"thinking" trace (emitted by reasoning-capable
   *     models — e.g. Ollama surfaces `delta.reasoning` over its OpenAI-compatible
   *     endpoint). Non-reasoning models simply never yield `reasoning` parts.
   *     MUST be consumed for `result` to resolve.
   *   - `result` — Promise resolving to the final concatenated answer `text`, the
   *     full `reasoning` trace (empty string when the model emits none), and token
   *     usage once the stream completes.
   *
   * Provider support mirrors `streamCall`: OpenAI-compatible only (llamacpp,
   * local, openrouter, requesty, ollama, plus any provider exposed via an
   * OpenAI-compatible URL).
   */
  async streamText(params: {
    systemPrompts: string[];
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    modelWeight?: ModelWeight;
    metadata?: Record<string, any>;
    tokenUsageType?: string;
    relationshipId?: string;
    relationshipType?: string;
  }): Promise<{
    fullStream: AsyncIterable<{ type: "text" | "reasoning"; delta: string }>;
    result: Promise<{
      text: string;
      reasoning: string;
      tokenUsage: { input: number; output: number };
      modelWeight: ModelWeight;
    }>;
  }> {
    const modelWeight = params.modelWeight ?? ModelWeight.Normal;
    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature,
      costFn: (tokens) => this.tokenUsageService.computeCost({ tokens, modelWeight }),
    });

    const system = params.systemPrompts.join("\n\n");

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions: params.prompt,
      inputParams: {},
      history: [],
      tools: [],
      outputSchemaName: "text",
    });

    // Same OpenAI-compatible provider gate as streamCall.
    const openaiCompatProviders = new Set(["llamacpp", "local", "openrouter", "requesty", "ollama"]);
    if (!openaiCompatProviders.has(aiConfig.provider) && !aiConfig.url) {
      session.close({
        finalStatus: "error",
        errorMessage: `streamText does not yet support provider "${aiConfig.provider}"`,
        totalTokens: { input: 0, output: 0 },
        warnings: [],
        parseFallbacks: [],
      });
      throw new Error(
        `LLMService.streamText: provider "${aiConfig.provider}" not supported. ` +
          `Add a Vercel AI SDK adapter to LLMService.streamText or use an OpenAI-compatible URL.`,
      );
    }

    const provider = createOpenAICompatible({
      name: aiConfig.provider || "narr8",
      apiKey: aiConfig.apiKey,
      baseURL: aiConfig.url,
      // Pin OpenRouter routing on the streaming path too (see streamCall). The
      // narrator runs here; an unpinned stream can be misrouted to a moderating
      // provider that refuses explicit content mid-stream.
      ...(aiConfig.provider === "openrouter" && aiConfig.region
        ? { fetch: openRouterEscalatingFetch(aiConfig.region, aiConfig.allowFallbacks ?? true) }
        : {}),
    });
    const model = provider.chatModel(aiConfig.model);

    session.startIteration("final-structured", []);

    const attemptTimeoutMs = this.attemptTimeoutMs(params.timeout);
    const label = `${(params.metadata?.nodeName as string) ?? "llm.streamText"}:${aiConfig.model}`;

    // One attempt = one abort controller + one whole-stream timeout (see
    // streamCall). The AbortError surfaces as a rejection on the awaited
    // promises below (caught + logged).
    const startAttempt = () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);
      timeoutId.unref?.();
      return {
        controller,
        timeoutId,
        handle: streamText({
          model,
          system,
          prompt: params.prompt,
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
          maxRetries: 2,
          abortSignal: controller.signal,
        }),
      };
    };
    let attempt = startAttempt();
    // See streamCall: a stream may only be restarted while the consumer has not
    // yet read a single part.
    let consumerStarted = false;

    const resultPromise: Promise<{
      text: string;
      reasoning: string;
      tokenUsage: { input: number; output: number };
      modelWeight: ModelWeight;
    }> = (async () => {
      for (let retry = 0; ; retry++) {
        try {
          const text = await attempt.handle.text;
          const reasoning = (await attempt.handle.reasoningText) ?? "";
          const usage = await attempt.handle.usage;
          const input = usage?.inputTokens ?? 0;
          const output = usage?.outputTokens ?? 0;
          const cached = usage?.inputTokenDetails?.cacheReadTokens ?? 0;

          session.recordResponse({
            content: text,
            tokenUsage: { input, output },
            finishReason: String(await attempt.handle.finishReason),
          });
          session.close({
            finalStatus: "success",
            totalTokens: { input, output, cached },
            warnings: [],
            parseFallbacks: [],
          });
          clearTimeout(attempt.timeoutId);
          await this.persistUsage(
            {
              tokenUsageType: params.tokenUsageType,
              relationshipId: params.relationshipId,
              relationshipType: params.relationshipType,
              modelWeight,
            },
            { input, output, cached },
          );

          return { text, reasoning, tokenUsage: { input, output }, modelWeight };
        } catch (error) {
          // Restartable only while nothing has been delivered — see
          // `consumerStarted`.
          if (!consumerStarted && retry < TRANSIENT_RETRY_WAITS_MS.length && this.isTransientNetworkError(error)) {
            clearTimeout(attempt.timeoutId);
            attempt.controller.abort();
            await this.waitBeforeTransientRetry(label, retry, error);
            attempt = startAttempt();
            continue;
          }
          clearTimeout(attempt.timeoutId);
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
          // A narration that streamed for 20s and then broke was still generated
          // and still billed — read whatever usage settled (see streamCall), under
          // the same bound so `result` always settles.
          const usage = await this.readUsageBounded(attempt.handle.usage);
          const input = usage?.inputTokens ?? 0;
          const output = usage?.outputTokens ?? 0;
          const cached = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
          session.close({
            finalStatus: "error",
            errorMessage: message,
            errorStack: stack,
            totalTokens: { input, output, cached },
            warnings: [],
            parseFallbacks: [],
          });
          await this.persistUsageOnFailure(
            {
              tokenUsageType: params.tokenUsageType,
              relationshipId: params.relationshipId,
              relationshipType: params.relationshipType,
              modelWeight,
            },
            { input, output, cached },
          );
          console.error("[LLMService.streamText] Error:", error);
          const wrapped = new Error(`LLM streamText error: ${message}`);
          (wrapped as Error & { cause?: unknown }).cause = error;
          throw wrapped;
        }
      }
    })();

    // Normalize the AI SDK `fullStream` to text/reasoning deltas. Consuming this
    // is what drives `resultPromise` (the `text`/`reasoning`/`usage` promises) to
    // resolve. Reasoning-capable models interleave `reasoning-delta` parts (e.g.
    // Ollama emits the full thinking trace before answer content).
    async function* normalizedStream(): AsyncGenerator<{ type: "text" | "reasoning"; delta: string }> {
      // The first pull marks the stream unrestartable (see `consumerStarted`),
      // and reads `attempt` late so a consumer that starts after a transient
      // retry gets the stream that actually connected.
      consumerStarted = true;
      for await (const part of attempt.handle.fullStream) {
        if (part.type === "text-delta") {
          yield { type: "text", delta: part.text };
        } else if (part.type === "reasoning-delta") {
          yield { type: "reasoning", delta: part.text };
        } else if (part.type === "error") {
          throw part.error;
        }
      }
    }

    // Surface (don't swallow) a rejected result even when the caller stops
    // consuming `fullStream` on error (e.g. abort/timeout or an unreachable
    // model) and therefore never awaits `result`. Logging marks the promise as
    // handled; callers that DO await it still receive the rejection.
    resultPromise.catch((err) => this.logger.warn(`streamText result rejected: ${String(err)}`));

    return {
      fullStream: normalizedStream(),
      result: resultPromise,
    };
  }

  /**
   * Structured extraction via FORCED tool calling — the gemma/Ollama-reliable
   * counterpart to `streamCall`/`call()`'s `withStructuredOutput`, which fails on
   * models that don't support `response_format` json_schema. Forces the model to
   * call a single tool and returns its (Zod-validated) arguments.
   */
  async extractViaTool<T>(params: {
    systemPrompts: string[];
    prompt: string;
    tool: { name: string; description: string; schema: ZodType<T> };
    modelWeight?: ModelWeight;
    metadata?: Record<string, any>;
    tokenUsageType?: string;
    relationshipId?: string;
    relationshipType?: string;
    disableThinking?: boolean;
    /** Optional: how much hidden reasoning the model may spend. Overrides
     * `disableThinking` and the tier default. Unset = provider default. */
    reasoningEffort?: ReasoningEffort;
    maxOutputTokens?: number;
    frequencyPenalty?: number;
    /** Sampling temperature. Defaults to getLLM's 0.2 (near-greedy, good for
     * deterministic extraction). Raise it for creative generation (e.g. game
     * creation) where greedy decoding collapses onto the model's prior names. */
    temperature?: number;
    /** Opt-in Redis caching keyed on generic params (modelWeight/temperature/
     * systemPrompts/prompt). A hit returns early WITHOUT invoking the provider,
     * so it costs no tokens. Default: false. */
    cacheable?: boolean;
    /** Per-attempt request budget in ms. Defaults to `ai.requestTimeoutMs`. */
    timeout?: number;
  }): Promise<T> {
    const modelWeight = params.modelWeight ?? ModelWeight.Normal;

    // Cache lookup BEFORE provider invocation. A hit returns the stored payload
    // immediately — no provider call, no token persistence (a hit is free).
    let cacheKey: string | undefined;
    if (params.cacheable === true && this.cache) {
      cacheKey = buildCacheKey({
        modelWeight,
        temperature: params.temperature,
        systemPrompts: params.systemPrompts,
        prompt: params.prompt,
      });
      const hit = await this.cache.get<T>(cacheKey);
      if (hit !== null) return hit;
    }

    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature ?? 0.2,
      costFn: (tokens) => this.tokenUsageService.computeCost({ tokens, modelWeight }),
    });

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions: params.prompt,
      inputParams: {},
      history: [],
      tools: [{ name: params.tool.name, description: params.tool.description, schema: params.tool.schema }],
      outputSchemaName: params.tool.name,
    });

    const attemptTimeoutMs = this.attemptTimeoutMs(params.timeout);
    // Hoisted above the try so the catch can bill the attempts the provider
    // already served before the failure. Accumulated (not overwritten) across
    // attempts: the nudge retry is a SECOND request and is charged as one.
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    try {
      const model = this.modelService.getLLM({
        modelWeight,
        disableThinking: params.disableThinking,
        reasoningEffort: params.reasoningEffort,
        maxOutputTokens: params.maxOutputTokens,
        frequencyPenalty: params.frequencyPenalty,
        temperature: params.temperature,
        timeoutMs: attemptTimeoutMs,
      });
      const tool = new DynamicStructuredTool({
        name: params.tool.name,
        description: params.tool.description,
        schema: params.tool.schema as any,
        func: async (input: unknown) => JSON.stringify(input),
      });
      const bound = model.bindTools!([tool], { tool_choice: params.tool.name });
      const systemPrompt = params.systemPrompts.join("\n\n");
      const baseMessages = [new SystemMessage(systemPrompt), new HumanMessage(params.prompt)];
      session.startIteration("final-structured", []);

      // Diagnostic for the no-tool-call path: dump exactly what the provider
      // returned so a future regression is debuggable without re-instrumenting.
      const describe = (r: AIMessage, attempt: string) => {
        const content = typeof r?.content === "string" ? r.content : JSON.stringify(r?.content);
        const call0 = (r?.tool_calls ?? [])[0];
        console.error(
          `[extractViaTool] ${params.tool.name} ${attempt}: no parseable tool call — ` +
            `finish_reason=${(r as any)?.response_metadata?.finish_reason} ` +
            `tool_calls=${(r?.tool_calls ?? []).length} invalid_tool_calls=${((r as any)?.invalid_tool_calls ?? []).length} ` +
            `contentLen=${content?.length ?? 0}`,
        );
        if (call0) {
          // A tool call WAS returned but its args failed the schema — log the args
          // and the validation issues so the mismatch is visible.
          const issues = params.tool.schema.safeParse(call0.args as unknown);
          console.error(
            `[extractViaTool] ${params.tool.name} ${attempt} tool_call.args(typeof=${typeof call0.args})=` +
              `${JSON.stringify(call0.args)?.slice(0, 2000)}`,
          );
          console.error(
            `[extractViaTool] ${params.tool.name} ${attempt} zodIssues=` +
              `${JSON.stringify(issues.success ? [] : issues.error.issues)?.slice(0, 1500)}`,
          );
        }
        console.error(`[extractViaTool] ${params.tool.name} ${attempt} content<<<\n${content?.slice(0, 2000)}\n>>>`);
      };

      // Resilience for local models (Gemma/Ollama) that ignore the forced
      // `tool_choice` and answer with text: accept a real tool call OR a payload
      // recovered from the message content (JSON, or Gemma's pseudo-token tool
      // text). `tool_choice` is only a soft hint on the OpenAI-compatible Ollama
      // endpoint, so a single empty `tool_calls` is NOT a hard failure — mirror
      // `streamCall`'s tool_calls → raw-content fallback chain. Returns the
      // validated payload or null.
      const tryExtract = (response: AIMessage): T | null => {
        const call = (response.tool_calls ?? [])[0];
        if (call) {
          // Try the args as-is, JSON-parsed (if a string), and unwrapped from a
          // single-key wrapper — accept the first shape that matches the schema.
          for (const candidate of toolArgCandidates(call.args)) {
            const fromTool = params.tool.schema.safeParse(candidate);
            if (fromTool.success) return fromTool.data;
          }
        }
        // 1) Model emitted the call as a JSON object in content (bare/fenced/prose).
        const salvaged = extractJsonObject(response.content);
        if (salvaged) {
          const fromContent = params.tool.schema.safeParse(salvaged);
          if (fromContent.success) {
            console.warn(`[extractViaTool] recovered ${params.tool.name} from JSON in message content`);
            return fromContent.data;
          }
        }
        // 2) Gemma/MLX emitted the call as pseudo-token text (`name{k:<|"|>v<|"|>}<tool_call|>`).
        const gemma = parseGemmaToolCallText(response.content);
        if (gemma) {
          const fromGemma = params.tool.schema.safeParse(gemma);
          if (fromGemma.success) {
            console.warn(`[extractViaTool] recovered ${params.tool.name} from Gemma pseudo-token tool text`);
            return fromGemma.data;
          }
        }
        return null;
      };

      // Each provider invocation is bounded independently — the nudge retry is a
      // second request and gets its own budget, not the leftovers of the first —
      // and each is retried on a transient network failure, with its own fresh
      // abort controller per attempt.
      const invokeBounded = async (messages: BaseMessage[], attempt: string): Promise<AIMessage> => {
        const response = (await this.runWithTransientRetry(
          `extractViaTool:${params.tool.name}:${attempt}`,
          attemptTimeoutMs,
          (signal) => bound.invoke(messages, { signal }),
        )) as AIMessage;
        // Bill as we go: an attempt that answered is charged whether or not its
        // payload turns out to be usable.
        const usage = (response as unknown as LLMRawResponse).usage_metadata;
        totalInputTokens += usage?.input_tokens ?? 0;
        totalOutputTokens += usage?.output_tokens ?? 0;
        totalCachedTokens += usage?.input_token_details?.cache_read ?? 0;
        return response;
      };

      let response = await invokeBounded(baseMessages, "attempt-1");
      let parsed = tryExtract(response);

      // One retry with an explicit nudge — local models frequently comply on a
      // second pass once told plainly that prose is not acceptable.
      if (parsed === null) {
        describe(response, "attempt-1");
        const nudge = new HumanMessage(
          `You did NOT call the \`${params.tool.name}\` tool. Do not write prose, refusals, or explanations. Respond ONLY by calling \`${params.tool.name}\` with valid arguments now.`,
        );
        response = await invokeBounded([...baseMessages, nudge], "attempt-2");
        parsed = tryExtract(response);
        if (parsed === null) describe(response, "attempt-2");
      }

      if (parsed === null) throw new Error("extractViaTool: model did not call the tool");

      // The winning response's OWN usage — what the dump's response entry
      // describes. The session total and the ledger use the accumulated figures
      // instead, so a nudge retry bills both requests rather than only the last.
      const inputTokens = (response as unknown as LLMRawResponse).usage_metadata?.input_tokens ?? 0;
      const outputTokens = (response as unknown as LLMRawResponse).usage_metadata?.output_tokens ?? 0;

      session.recordResponse({
        content: JSON.stringify(parsed),
        tokenUsage: { input: inputTokens, output: outputTokens },
        finishReason: "tool_call",
      });
      session.close({
        finalStatus: "success",
        totalTokens: { input: totalInputTokens, output: totalOutputTokens, cached: totalCachedTokens },
        warnings: [],
        parseFallbacks: [],
      });
      await this.persistUsage(
        {
          tokenUsageType: params.tokenUsageType,
          relationshipId: params.relationshipId,
          relationshipType: params.relationshipType,
          modelWeight,
        },
        { input: totalInputTokens, output: totalOutputTokens, cached: totalCachedTokens },
      );
      // Write-through on a miss so the next identical cacheable call hits.
      if (cacheKey && this.cache) await this.cache.set<T>(cacheKey, parsed as T);
      return parsed as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.close({
        finalStatus: "error",
        errorMessage: message,
        totalTokens: { input: totalInputTokens, output: totalOutputTokens, cached: totalCachedTokens },
        warnings: [],
        parseFallbacks: [],
      });
      // Two refusals still cost two generations — bill what was served before
      // giving up. Never throws, so the original error survives untouched.
      await this.persistUsageOnFailure(
        {
          tokenUsageType: params.tokenUsageType,
          relationshipId: params.relationshipId,
          relationshipType: params.relationshipType,
          modelWeight,
        },
        { input: totalInputTokens, output: totalOutputTokens, cached: totalCachedTokens },
      );
      console.error("[LLMService.extractViaTool] Error:", error);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  /**
   * Single-step model invocation with tools bound — the durable-checkpointing
   * counterpart to {@link call}'s internal tool loop. Performs exactly ONE
   * model STEP (no tool execution, no loop, no structured output) and returns
   * the raw AIMessage with any `tool_calls` untouched, so the caller (e.g. the
   * operator agent) can checkpoint state and execute the tool calls itself.
   *
   * "One step" is not "one socket": the step is bounded like every other call
   * (per-attempt budget, watchdog, deadline) and re-issued on a transient
   * network failure. What it never does is re-run the AGENT — the caller's
   * checkpointed state is untouched either way.
   *
   * Reuses {@link call}'s model construction (`modelService.getLLM` +
   * `bindTools`) and `LLMCallDumper` hooks. The step's token usage is still
   * RETURNED to the caller (so an agent can keep its own running total), and —
   * when `relationshipId`/`relationshipType` are supplied — is now also
   * persisted here, exactly like every other provider call in this service.
   * A caller that omits the attribution gets the previous behaviour: nothing is
   * written. Each step is billed once, by whichever path completes it.
   *
   * @param params.systemPrompts - System prompts, prepended (in order) as
   *                               SystemMessages before `messages`
   * @param params.messages - Conversation messages sent verbatim to the model
   * @param params.tools - Tools to bind (NOT executed by this method)
   * @param params.temperature - Optional temperature override
   * @param params.metadata - Optional metadata for dump-session tracking
   * @param params.tokenUsageType - Optional usage type for the recorded row
   * @param params.relationshipId - Optional entity this usage is attributed to
   * @param params.relationshipType - Optional entity type for the attribution
   *
   * @returns The raw AIMessage (tool_calls intact) plus this call's token usage
   */
  async callStep(params: {
    systemPrompts: string[];
    messages: BaseMessage[];
    tools: DynamicStructuredTool[];
    temperature?: number;
    metadata?: Record<string, unknown>;
    tokenUsageType?: string;
    relationshipId?: string;
    relationshipType?: string;
  }): Promise<{ message: AIMessage; tokenUsage: { input: number; output: number } }> {
    const modelWeight = ModelWeight.Normal;
    const aiConfig = this.modelService.getResolvedConfig(modelWeight);
    const session: DumpSession = this.dumper.startSession({
      metadata: params.metadata as DumpSessionStartParams["metadata"],
      model: aiConfig.model,
      provider: aiConfig.provider,
      temperature: params.temperature,
    });

    session.recordInputs({
      systemPrompts: params.systemPrompts,
      instructions: "",
      inputParams: {},
      history: [],
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        schema: (t as any).schema,
      })),
      outputSchemaName: "callStep",
    });

    // This method used to be the ONE provider call in the service with no bound
    // of any kind: no per-attempt budget on the model, no watchdog, no deadline.
    // A stalled operator step therefore hung its durable run forever, which is
    // exactly the failure `runBounded` exists to end — so it gets the same
    // treatment as `call()`, plus the transient-network retry.
    const attemptTimeoutMs = this.attemptTimeoutMs();
    const label = `llm.callStep:${aiConfig.model}`;
    // Hoisted above the try so the catch reports and bills whatever the step
    // managed to consume before it threw.
    let input = 0;
    let output = 0;
    // Prompt-cache hits, priced at `cachedInputCostPer1MTokens` by `computeCost`.
    // The operator re-sends its whole conversation every step, so a cache hit is
    // the NORM here: dropping this would price the entire prompt at the uncached
    // rate and over-bill every operator row. Credited exactly as `call()` and
    // `streamCall` credit theirs.
    let cached = 0;
    try {
      const baseModel = this.modelService.getLLM({
        temperature: params.temperature,
        modelWeight,
        timeoutMs: attemptTimeoutMs,
      });
      const modelWithTools = params.tools.length > 0 ? baseModel.bindTools(params.tools) : baseModel;

      const conversationMessages: BaseMessage[] = [
        ...params.systemPrompts.map((p) => new SystemMessage(p)),
        ...params.messages,
      ];

      session.startIteration("tool-loop", conversationMessages);

      const response = (await this.runWithTransientRetry(label, attemptTimeoutMs, (signal) =>
        modelWithTools.invoke(
          conversationMessages,
          params.metadata ? { metadata: params.metadata, signal } : { signal },
        ),
      )) as AIMessage;

      const raw = response as unknown as LLMRawResponse;
      input = raw.usage_metadata?.input_tokens ?? 0;
      output = raw.usage_metadata?.output_tokens ?? 0;
      cached = raw.usage_metadata?.input_token_details?.cache_read ?? 0;

      session.recordResponse({
        content: typeof (response as any).content === "string" ? (response as any).content : "",
        toolCalls: (response.tool_calls ?? []).map((c) => ({
          id: c.id ?? "",
          name: c.name,
          args: c.args,
        })),
        tokenUsage: { input, output },
        finishReason: raw.response_metadata?.finish_reason,
      });

      session.close({
        finalStatus: "success",
        totalTokens: { input, output, cached },
        warnings: [],
        parseFallbacks: [],
      });

      await this.persistUsage(
        {
          tokenUsageType: params.tokenUsageType,
          relationshipId: params.relationshipId,
          relationshipType: params.relationshipType,
          modelWeight,
        },
        { input, output, cached },
      );

      return { message: response, tokenUsage: { input, output } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 10).join("\n") : undefined;
      session.close({
        finalStatus: "error",
        errorMessage: message,
        errorStack: stack,
        totalTokens: { input, output, cached },
        warnings: [],
        parseFallbacks: [],
      });
      await this.persistUsageOnFailure(
        {
          tokenUsageType: params.tokenUsageType,
          relationshipId: params.relationshipId,
          relationshipType: params.relationshipType,
          modelWeight,
        },
        { input, output, cached },
      );
      console.error("[LLMService.callStep] Error:", error);
      throw error instanceof Error ? error : new Error(message);
    }
  }
}
