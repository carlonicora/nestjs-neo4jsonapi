import { Embeddings, EmbeddingsInterface } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { ChatVertexAI, VertexAIEmbeddings } from "@langchain/google-vertexai";
import { AzureOpenAIEmbeddings, ChatOpenAI, ChatOpenAIResponses, OpenAIEmbeddings } from "@langchain/openai";
import { Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ClsService } from "nestjs-cls";
import OpenAI, { AzureOpenAI } from "openai";
import { baseConfig } from "../../../config/base.config";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { AppLoggingService } from "../../logging/services/logging.service";
import { ModelWeight } from "../enums/model.weight";
import { ReasoningEffort } from "../enums/reasoning.effort";
import { AiConnectionType, ResolvedAiCandidate } from "../interfaces/ai-candidate.interface";
import { vertexLocationParams } from "../utils/vertex.utils";
import { AiConnectionResolverService } from "./ai-connection-resolver.service";
import { EmbedderTokenBucketService } from "./embedder-token-bucket.service";
import { openRouterEscalatingFetch } from "./openrouter-fetch";
import { reasoningContentFetch } from "./reasoning-content-fetch";
import { RateLimitedEmbedder } from "./rate-limited-embedder";
import { unsupportedParamFetch } from "./unsupported-param-fetch";

/**
 * Tracks GCP credential temp files written this process so they can be removed
 * on exit. Each path is UUID-unique (see {@link writeGcpCredentials}).
 */
const writtenCredsPaths = new Set<string>();
let gcpCleanupRegistered = false;

/**
 * Securely materialises Google Vertex credentials to a temp file.
 *
 * Security properties (Wave 4 hardening):
 * - UUID-unique filename — no predictable path another process can pre-create
 *   or read by guessing.
 * - mode 0o600 — owner read/write only.
 * - registers a single best-effort `exit` cleanup that unlinks every file we
 *   wrote, so secrets do not linger in the OS temp dir.
 *
 * @param decodedCredentials - The DECODED credentials JSON text to write. The
 *   caller already has the decoded JSON in scope (`credentialsJson`), so the
 *   helper writes it verbatim — it does NOT base64-decode (avoids double-decode).
 * @param tag - A modality tag used only to make the filename human-readable.
 * @returns The absolute path of the written credentials file.
 */
export function writeGcpCredentials(decodedCredentials: string, tag: string): string {
  const credsPath = path.join(os.tmpdir(), `gcp-creds-${tag}-${crypto.randomUUID()}.json`);
  fs.writeFileSync(credsPath, decodedCredentials, { mode: 0o600 });
  writtenCredsPaths.add(credsPath);
  if (!gcpCleanupRegistered) {
    process.on("exit", () => {
      for (const p of writtenCredsPaths) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* best-effort */
        }
      }
    });
    gcpCleanupRegistered = true;
  }
  return credsPath;
}

/**
 * Validates an LLM endpoint URL before an API key is sent to it.
 *
 * Security properties (Wave 4 hardening):
 * - Refuses an empty / missing URL for providers that require one.
 * - Refuses a malformed URL.
 * - Refuses plaintext HTTP to a non-local host (would leak the API key on the
 *   wire). localhost / 127.0.0.1 / ::1 / *.local are exempt (dev loopback).
 * - Optionally enforces an `AI_URL_ALLOWLIST` (comma-separated host suffixes).
 *
 * @throws {Error} if the URL fails any check.
 */
export function validateAiUrl(url: string, provider: string): void {
  if (!url) throw new Error(`LLM provider "${provider}" requires AI_URL to be set`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`AI_URL is not a valid URL: ${url}`);
  }
  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  const isDotLocal = parsed.hostname.endsWith(".local");
  if (parsed.protocol !== "https:" && !isLocalhost && !isDotLocal) {
    throw new Error(`AI_URL must be HTTPS (or localhost) — refusing to send API key over ${parsed.protocol}`);
  }
  const allowlist = baseConfig.ai.urlAllowlist;
  if (allowlist) {
    const ok = allowlist.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    if (!ok) throw new Error(`AI_URL hostname "${parsed.hostname}" not in allowlist`);
  }
}

/** The complete set of values {@link ReasoningEffort} allows. */
const REASONING_EFFORTS: ReadonlySet<string> = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high"]);

/**
 * Narrows a CONFIG-sourced reasoning effort to the allowed set.
 *
 * `AI_REASONING_EFFORT` reaches this code as a free-form string, and a typo
 * (`AI_REASONING_EFFORT=lwo`) would otherwise be cast straight onto the wire. The
 * provider answers 400 `unsupported_value`, which `unsupportedParamFetch` then
 * remembers for that (parameter, value) pair — one wasted round-trip per distinct
 * typo, and an effort silently degraded to the provider default for the rest of the
 * process. Rejecting it here keeps the misconfiguration visible and costs nothing.
 *
 * Per-call values are NOT routed through this: those are typed `ReasoningEffort` at
 * the call site, so the compiler already guarantees them.
 *
 * @returns the effort when recognised, otherwise undefined (tier default unset).
 */
export function normaliseConfiguredReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && REASONING_EFFORTS.has(value)) return value as ReasoningEffort;
  console.warn(
    `[ModelService] ignoring unrecognised reasoning effort ${JSON.stringify(value)} — ` +
      `expected one of ${[...REASONING_EFFORTS].join(", ")}`,
  );
  return undefined;
}

/** Gemini's own thinking-level vocabulary (`GoogleThinkingLevel` in @langchain/google-common). */
export type GeminiThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

/**
 * Is `model` a Gemini 3-or-later model, i.e. one that understands `thinkingLevel`?
 *
 * Gemini introduced `thinking_level` with the 3.x family, and sending it to an
 * EARLIER model is a hard error rather than a no-op — so this gate is what keeps
 * a `gemini-2.5-*` tier working unchanged when a reasoning effort is configured.
 *
 * Matched on the major version rather than the literal string "gemini-3" so 3.1,
 * 3.5 and a future 4.x are all covered without another edit. The name is searched
 * anywhere in the string because providers qualify it differently
 * ("gemini-3.1-flash-lite", "google/gemini-3.1-flash-lite").
 */
export function supportsGeminiThinkingLevel(model?: string): boolean {
  const match = /gemini-(\d+)/i.exec(model ?? "");
  return match ? Number(match[1]) >= 3 : false;
}

/**
 * Maps this project's reasoning-effort vocabulary onto Gemini's thinking levels.
 *
 * `none` becomes `MINIMAL` because Gemini 3 has no zero: MINIMAL is documented as
 * "as close as possible to a zero budget for thinking, but still requires thought
 * signatures". Reporting the nearest honest equivalent beats refusing to send
 * anything and silently inheriting the model default.
 *
 * NOTE this deliberately does NOT go through `reasoningEffort` on the Vertex
 * client: @langchain/google-common maps THAT to `maxReasoningTokens`, a token
 * BUDGET, and Gemini 3 rejects a request carrying both a thinking budget and a
 * thinking level. The level is the parameter we want; the budget is a different
 * knob wearing a similar name.
 */
export function toGeminiThinkingLevel(effort: ReasoningEffort): GeminiThinkingLevel {
  switch (effort) {
    case "none":
    case "minimal":
      return "MINIMAL";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
  }
}

interface LLMParameters {
  apiKey: string;
  temperature: number;
  model: string;
  configuration: {
    baseURL: string;
    defaultHeaders?: Record<string, string>;
    fetch?: typeof fetch;
  };
  modelKwargs?: Record<string, unknown>;
  /** Per-attempt request budget handed to the OpenAI client (see `timeoutMs` below). */
  timeout?: number;
}

/**
 * Safety valve for {@link ModelService.llmCache}. A key is built from a bounded
 * set of resolved parameters (provider/endpoint/model/temperature/…), so the map
 * cannot grow without bound in normal operation. Should a caller nevertheless
 * sweep a continuous parameter (a per-call temperature, say), the cache would
 * turn into the leak it exists to prevent — so past this many entries it is
 * emptied and the anomaly is logged rather than silently retained.
 */
const LLM_CACHE_MAX_ENTRIES = 100;

/**
 * Copies only the DEFINED entries of an object.
 *
 * Used when a resolved candidate is merged over an env config block: spreading
 * the candidate wholesale would let its absent optionals (`region: undefined`,
 * …) erase perfectly good env values, and would drop fields the candidate shape
 * has no room for at all (`secret`).
 */
function definedFieldsOnly<T extends Record<string, unknown>>(source: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) if (value !== undefined) result[key] = value;
  return result as Partial<T>;
}

@Injectable()
export class ModelService implements OnModuleInit {
  private cachedEmbedder?: EmbeddingsInterface;

  /**
   * Connection id the {@link cachedEmbedder} was built from. The embedder is
   * memoised for the lifetime of the process (it owns the shared rate-limit
   * bucket), so without this a DB-side embedder change would stay invisible
   * until a restart.
   */
  private cachedEmbedderConnectionId?: string;

  /**
   * Chat models built by {@link getLLM}, keyed on every parameter that is BAKED
   * INTO the instance (see the key built there).
   *
   * Why: `getLLM` used to construct a fresh `ChatOpenAI` — and with it a fresh
   * OpenAI SDK client, its agent and its fetch middleware — on every single LLM
   * call. Under a worker load that is thousands of short-lived clients, which is
   * heap the process never gets back quickly enough.
   *
   * Two constructions are deliberately NOT cached (both handled in `getLLM`):
   * MOCK_AI's `FakeListChatModel` (stateful — it walks a response list, so
   * sharing one across calls changes what tests see), and an OpenRouter tier
   * with a pinned `region` (its `openRouterEscalatingFetch` closure is per-call
   * BY DESIGN: attempt 1 hard-pins, retries allow fallbacks — sharing it would
   * leave every later call permanently escalated).
   *
   * `unsupportedParamFetch` is share-safe: its learned verdicts live in a
   * module-level map keyed by deployment, with no per-call state.
   */
  private readonly llmCache = new Map<string, BaseChatModel>();

  constructor(
    private readonly clsService: ClsService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    // Optional so existing consumers / test harnesses that construct ModelService
    // with only (cls, config) keep resolving. When absent (or when
    // ai.embedder.rateLimit is unset), getEmbedder() returns the raw provider
    // embedder — the rate-limit wrapper is purely additive.
    @Optional() private readonly bucket?: EmbedderTokenBucketService,
    @Optional() private readonly logger?: AppLoggingService,
    // Optional for the same reason as `bucket`: every existing consumer and test
    // harness constructs ModelService with (cls, config) only. When absent there
    // is no DB-backed chain at all and every modality resolves to exactly one
    // candidate built from the `.env` config — today's behaviour, byte for byte.
    @Optional() private readonly aiConnectionResolver?: AiConnectionResolverService,
  ) {}

  /**
   * Fail-closed MOCK_AI safety gate. MOCK_AI returns synthetic data (no provider
   * call) for every model/embedder/structured call — invaluable for local dev and
   * tests, catastrophic in production (it would write fake AI data into the graph).
   * This refuses to start when MOCK_AI is on AND the environment is production.
   * Reads the module-level `baseConfig` rather than the injected ConfigService on
   * purpose: a fail-closed safety gate must not depend on DI wiring being correct,
   * and `baseConfig` is a plain constant resolved at import time.
   */
  onModuleInit(): void {
    if (this.aiConfig.mock && baseConfig.api.env === "production") {
      throw new Error("MOCK_AI must never run in production — refusing to start.");
    }
  }

  private get aiConfig(): ConfigAiInterface {
    return this.configService.get<ConfigAiInterface>("ai");
  }

  private get visionConfig() {
    return this.aiConfig.vision;
  }

  private get audioConfig() {
    return this.aiConfig.audio;
  }

  /**
   * Resolves the `.env` AI config block for a model weight.
   * Undefined / Normal → `ai`; Lite → `aiLite`; Large → `aiLarge`.
   *
   * This is the FINAL fallback of every chat chain — {@link getResolvedConfig}
   * layers the resolved (DB-first) candidate over it.
   */
  private envTierConfig(weight?: ModelWeight): ConfigAiInterface["ai"] {
    switch (weight) {
      case ModelWeight.Lite:
        return this.aiConfig.aiLite;
      case ModelWeight.Large:
        return this.aiConfig.aiLarge;
      default:
        return this.aiConfig.ai;
    }
  }

  /** Chat tier → AI connection type. Undefined / Normal → `ai`. */
  private weightToType(weight?: ModelWeight): AiConnectionType {
    switch (weight) {
      case ModelWeight.Lite:
        return "aiLite";
      case ModelWeight.Large:
        return "aiLarge";
      default:
        return "ai";
    }
  }

  /**
   * Ordered fallback candidates for a chat tier, healthiest first.
   *
   * Without a resolver (tests, minimal harnesses, an app that never registered
   * the AI-connection feature) this is exactly one `.env` candidate — today's
   * behaviour.
   */
  getCandidates(weight?: ModelWeight): ResolvedAiCandidate[] {
    return this.getCandidatesForType(this.weightToType(weight));
  }

  /**
   * Ordered fallback candidates for any AI connection type.
   *
   * Never throws: a resolver failure degrades to the `.env` candidate rather
   * than to "no AI" (spec § 5), because this sits on the hot path of every
   * single model construction.
   */
  getCandidatesForType(type: AiConnectionType): ResolvedAiCandidate[] {
    if (this.aiConnectionResolver) {
      try {
        const candidates = this.aiConnectionResolver.resolve(type);
        if (candidates.length > 0) return candidates;
      } catch (error) {
        const warning = `[ModelService] AI connection resolver failed for "${type}" — falling back to the .env connection: ${
          error instanceof Error ? error.message : String(error)
        }`;
        if (this.logger) this.logger.warn(warning, ModelService.name);
        else console.warn(warning);
      }
    }
    return [this.envCandidate(type)];
  }

  /** Reports a transient failure so the resolver cools that connection down. */
  notifyCandidateFailure(candidate: ResolvedAiCandidate): void {
    this.aiConnectionResolver?.markFailure(candidate.connectionId);
  }

  /**
   * Picks one link out of a chain. Out-of-range indexes clamp to the last
   * candidate, so a retry loop that outruns the chain simply keeps hammering
   * the final (`.env`) link instead of crashing.
   */
  private pickCandidate(type: AiConnectionType, candidateIndex?: number): ResolvedAiCandidate {
    const candidates = this.getCandidatesForType(type);
    if (candidates.length === 0) return this.envCandidate(type);
    const index = Math.min(Math.max(candidateIndex ?? 0, 0), candidates.length - 1);
    return candidates[index];
  }

  /**
   * The `.env` block of one connection type, normalised to a candidate.
   *
   * Used when no resolver is wired. A resolver appends its own env candidate as
   * the last link of every chain, so this is the no-resolver twin of that entry
   * and MUST stay field-for-field identical to it.
   *
   * Tolerates missing config blocks (a harness that only configures the chat
   * tiers must not explode when something asks for the vision chain).
   */
  private envCandidate(type: AiConnectionType): ResolvedAiCandidate {
    const cfg = this.aiConfig ?? ({} as ConfigAiInterface);
    const identity = { source: "env" as const, connectionId: `env:${type}`, connectionType: type };

    switch (type) {
      case "vision": {
        const vision = cfg.vision;
        return {
          ...identity,
          provider: vision?.provider ?? "",
          apiKey: vision?.apiKey ?? "",
          model: vision?.model ?? "",
          url: vision?.url ?? "",
          region: vision?.region,
          instance: vision?.instance,
          apiVersion: vision?.apiVersion,
          googleCredentialsBase64: vision?.googleCredentialsBase64,
          reasoningEffort: vision?.reasoningEffort,
          inputCostPer1MTokens: vision?.inputCostPer1MTokens,
          outputCostPer1MTokens: vision?.outputCostPer1MTokens,
        };
      }

      case "audio": {
        const audio = cfg.audio;
        return {
          ...identity,
          provider: audio?.provider ?? "",
          apiKey: audio?.apiKey ?? "",
          model: audio?.model ?? "",
          url: audio?.url ?? "",
          region: audio?.region,
          instance: audio?.instance,
          apiVersion: audio?.apiVersion,
          googleCredentialsBase64: audio?.googleCredentialsBase64,
          inputCostPer1MTokens: audio?.inputCostPer1MTokens,
          outputCostPer1MTokens: audio?.outputCostPer1MTokens,
          costPerMinute: audio?.costPerMinute,
          directUrl: audio?.directUrl,
          language: audio?.language,
          directFormat: audio?.directFormat,
          directProvider: audio?.directProvider,
        };
      }

      case "image": {
        const image = cfg.image;
        return {
          ...identity,
          provider: image?.provider ?? "",
          apiKey: image?.apiKey ?? "",
          model: image?.model ?? "",
          url: image?.url ?? "",
          region: image?.region,
          instance: image?.instance,
          apiVersion: image?.apiVersion,
          googleCredentialsBase64: image?.googleCredentialsBase64,
          inputCostPer1MTokens: image?.inputCostPer1MTokens,
          outputCostPer1MTokens: image?.outputCostPer1MTokens,
        };
      }

      case "embedder": {
        const embedder = cfg.embedder;
        return {
          ...identity,
          provider: embedder?.provider ?? "",
          apiKey: embedder?.apiKey ?? "",
          model: embedder?.model ?? "",
          url: embedder?.url ?? "",
          region: embedder?.region,
          instance: embedder?.instance,
          apiVersion: embedder?.apiVersion,
          googleCredentialsBase64: embedder?.googleCredentialsBase64,
          dimensions: embedder?.dimensions,
          inputCostPer1MTokens: embedder?.inputCostPer1MTokens,
        };
      }

      case "transcriber": {
        const transcriber = cfg.transcriber;
        return {
          ...identity,
          provider: transcriber?.provider ?? "",
          apiKey: transcriber?.apiKey ?? "",
          model: transcriber?.model ?? "",
          url: transcriber?.url ?? "",
          apiVersion: transcriber?.apiVersion,
        };
      }

      case "documentAi": {
        const documentAi = cfg.documentAi;
        return {
          ...identity,
          provider: documentAi?.provider ?? "",
          apiKey: documentAi?.apiKey ?? "",
          model: documentAi?.model ?? "",
          url: documentAi?.url ?? "",
          apiVersion: documentAi?.apiVersion,
          costPerPage: documentAi?.costPerPage,
        };
      }

      default: {
        const tier = type === "aiLite" ? cfg.aiLite : type === "aiLarge" ? cfg.aiLarge : cfg.ai;
        return {
          ...identity,
          provider: tier?.provider ?? "",
          apiKey: tier?.apiKey ?? "",
          model: tier?.model ?? "",
          url: tier?.url ?? "",
          region: tier?.region,
          instance: tier?.instance,
          apiVersion: tier?.apiVersion,
          googleCredentialsBase64: tier?.googleCredentialsBase64,
          allowFallbacks: tier?.allowFallbacks,
          reasoningEffort: tier?.reasoningEffort,
          maxOutputTokens: tier?.maxOutputTokens,
          inputCostPer1MTokens: tier?.inputCostPer1MTokens,
          outputCostPer1MTokens: tier?.outputCostPer1MTokens,
          cachedInputCostPer1MTokens: tier?.cachedInputCostPer1MTokens,
        };
      }
    }
  }

  /**
   * Resolves the effective AI config block for a model weight: the first
   * healthy candidate of that chat tier, expressed in the `.env` block's shape.
   *
   * The signature is deliberately unchanged, so every existing caller
   * (`LLMService` cost lookups, {@link supportsStrictStructuredOutput}, …)
   * transparently reads the DB-first configuration. Only DEFINED candidate
   * fields are layered over the env block, so fields the candidate shape does
   * not carry (`secret`) survive.
   */
  getResolvedConfig(weight?: ModelWeight): ConfigAiInterface["ai"] {
    const envBlock = this.envTierConfig(weight);
    const candidate = this.pickCandidate(this.weightToType(weight));
    if (candidate.source === "env") return envBlock;

    return {
      ...envBlock,
      ...definedFieldsOnly({
        provider: candidate.provider,
        apiKey: candidate.apiKey,
        model: candidate.model,
        url: candidate.url,
        region: candidate.region,
        instance: candidate.instance,
        apiVersion: candidate.apiVersion,
        googleCredentialsBase64: candidate.googleCredentialsBase64,
        allowFallbacks: candidate.allowFallbacks,
        reasoningEffort: candidate.reasoningEffort,
        maxOutputTokens: candidate.maxOutputTokens,
        inputCostPer1MTokens: candidate.inputCostPer1MTokens,
        outputCostPer1MTokens: candidate.outputCostPer1MTokens,
        cachedInputCostPer1MTokens: candidate.cachedInputCostPer1MTokens,
      }),
    };
  }

  /**
   * Whether this tier's provider honours OpenAI's STRICT structured-output mode.
   *
   * Only the OpenAI-compatible chat-completions family enforces `strict`.
   * `ChatGoogleBase.withStructuredOutput` ignores the flag outright, so on Vertex
   * a strict-shaped schema costs the model an explicit null for every optional
   * field and returns no guarantee in exchange — verified against a live
   * gemini-2.5-flash-lite deployment, which accepts both shapes.
   *
   * Answered from the tier's PROVIDER, which this service already owns, rather
   * than `instanceof ChatOpenAI`: `instanceof` fails silently when two copies of
   * `@langchain/openai` resolve, which is exactly the dual-instance hazard the
   * July 2026 dependency sweep removed.
   */
  supportsStrictStructuredOutput(weight?: ModelWeight): boolean {
    return this.getResolvedConfig(weight).provider !== "vertex";
  }

  /**
   * Gets a configured LLM instance based on the current config.
   *
   * Supports multiple providers:
   * - `llamacpp`/`local`: Local llama.cpp server (OpenAI-compatible API)
   * - `openrouter`: OpenRouter cloud service
   * - `requesty`: Requesty proxy service
   * - `vertex`: Google Vertex AI (Gemini models)
   * - `azure`: Azure OpenAI Service — chat branch speaks the Responses API on
   *   the GA v1 surface ({instance}.openai.azure.com/openai/v1), not chat-completions
   * - any other provider name: generic OpenAI-compatible endpoint (requires `url`)
   *
   * Each model weight resolves its own full config block (provider, apiKey,
   * url, model, …), so different tiers can live on different providers.
   *
   * Instances are CACHED per resolved parameter set (see {@link llmCache}) —
   * identical parameters return the same client instead of building a new SDK
   * client per call. MOCK_AI and region-pinned OpenRouter tiers always get a
   * fresh instance; see the cache's docblock for why.
   *
   * @param params - Optional parameters
   * @param params.temperature - Temperature for text generation (0-2, default: 0.2)
   *                             Lower = more deterministic, Higher = more creative
   * @param params.maxOutputTokens - Maximum output tokens (default from config)
   * @param params.modelWeight - Which AI tier to use (undefined → Normal)
   * @param params.candidateIndex - Which link of the tier's fallback chain to
   *                                build (default 0 = first healthy candidate)
   * @returns Configured BaseChatModel instance from LangChain
   * @throws {Error} If the configured LLM type is not supported
   */
  getLLM(params?: {
    temperature?: number;
    maxOutputTokens?: number;
    frequencyPenalty?: number;
    modelWeight?: ModelWeight;
    /**
     * @deprecated Use `reasoningEffort: "none"` instead. Kept as a working alias
     * for backward compatibility — a published-library API is never removed.
     */
    disableThinking?: boolean;
    reasoningEffort?: ReasoningEffort;
    /** Per-attempt request budget in ms. Defaults to `ai.requestTimeoutMs`. */
    timeoutMs?: number;
    /**
     * Which link of this tier's fallback chain to build. 0 (default) is the
     * first healthy candidate; a retry loop advances it on a transient failure.
     * Out-of-range values clamp to the last candidate (the `.env` block).
     */
    candidateIndex?: number;
  }): BaseChatModel {
    if (this.aiConfig.mock) {
      return new FakeListChatModel({ responses: ["mock summary"] }) as unknown as BaseChatModel;
    }

    const temperature = params?.temperature ?? 0.2;
    const cfg = this.pickCandidate(this.weightToType(params?.modelWeight), params?.candidateIndex);
    const maxOutputTokens = params?.maxOutputTokens ?? cfg.maxOutputTokens;
    // Precedence (Shared Contracts, plan 2026-07-31-llm-latency-and-structured-output):
    // an explicit per-call `reasoningEffort` wins; failing that, the equally
    // explicit per-call `disableThinking` (the older boolean spelling of "none")
    // wins over the tier default — a per-call signal must never be silently
    // overridden by config, matching `temperature`/`maxOutputTokens` elsewhere in
    // this method. Only when the call passes neither does the tier default apply.
    const resolvedReasoningEffort: ReasoningEffort | undefined =
      params?.reasoningEffort ??
      (params?.disableThinking ? "none" : undefined) ??
      normaliseConfiguredReasoningEffort(cfg.reasoningEffort);
    const timeoutMs = params?.timeoutMs ?? this.aiConfig.requestTimeoutMs;

    // An OpenRouter tier with a pinned region gets a FRESH instance every call:
    // its escalating fetch is a per-call closure (attempt 1 hard-pins, retries
    // allow fallbacks), so a shared instance would stay escalated forever.
    const shareable = !(cfg.provider === "openrouter" && cfg.region);
    // Keyed on the RESOLVED effort, never the raw disableThinking/reasoningEffort
    // pair — two different spellings of the same effort must hit the same entry.
    // `timeoutMs` and `frequencyPenalty` are part of the key because both are
    // baked into the constructed client, not passed per invocation.
    // The connection id leads the key: two links of the same chain may agree on
    // every other resolved parameter yet be different deployments (and carry
    // different credentials), so each one caches its own client.
    const cacheKey = [
      cfg.connectionId,
      cfg.provider,
      cfg.instance ?? cfg.url,
      cfg.model,
      temperature,
      maxOutputTokens ?? "",
      params?.frequencyPenalty ?? "",
      resolvedReasoningEffort ?? "",
      timeoutMs,
    ].join("|");

    if (shareable) {
      const cached = this.llmCache.get(cacheKey);
      if (cached) return cached;
    }

    const model = this.buildChatModel(cfg, {
      temperature,
      maxOutputTokens,
      frequencyPenalty: params?.frequencyPenalty,
      credentialFileTag: "llm",
      disableThinking: params?.disableThinking,
      reasoningEffort: resolvedReasoningEffort,
      timeoutMs,
    });

    if (shareable) {
      this.llmCache.set(cacheKey, model);
      if (this.llmCache.size > LLM_CACHE_MAX_ENTRIES) {
        this.llmCache.clear();
        const warning =
          `[ModelService] LLM client cache exceeded ${LLM_CACHE_MAX_ENTRIES} entries and was cleared — ` +
          `a caller is varying a cached parameter (temperature / maxOutputTokens / frequencyPenalty / timeoutMs) per call`;
        if (this.logger) this.logger.warn(warning, ModelService.name);
        else console.warn(warning);
      }
    }

    return model;
  }

  /**
   * Gets a configured LLM instance for vision operations based on the current config.
   *
   * Supports multiple providers:
   * - `llamacpp`/`local`: Local llama.cpp server (OpenAI-compatible API)
   * - `openrouter`: OpenRouter cloud service
   * - `requesty`: Requesty service
   * - `vertex`: Google Vertex AI (Gemini models)
   * - `azure`: Azure OpenAI Service — chat branch speaks the Responses API on
   *   the GA v1 surface ({instance}.openai.azure.com/openai/v1), not chat-completions
   *
   * @param params - Optional parameters
   * @param params.temperature - Temperature for text generation (0-2, default: 0.1)
   * @param params.candidateIndex - Which link of the vision fallback chain to
   *                                build (default 0 = first healthy candidate)
   * @returns Configured BaseChatModel instance from LangChain
   * @throws {Error} If the configured LLM type is not supported
   */
  getVisionLLM(params?: { temperature?: number; candidateIndex?: number }): BaseChatModel {
    if (this.aiConfig.mock) {
      return new FakeListChatModel({ responses: ["mock summary"] }) as unknown as BaseChatModel;
    }

    const temperature = params?.temperature ?? 0.1;
    const visionConfig = this.pickCandidate("vision", params?.candidateIndex);

    // Reasoning models (gpt-5 / o-series) accept `reasoning_effort` on the chat-completions
    // call. Lower effort = far fewer reasoning tokens = much faster. Passed via modelKwargs
    // (raw param) — this is what reaches the OpenAI-compatible chat-completions providers
    // (openrouter, requesty, ollama, llamacpp, the generic branch). Azure no longer takes this
    // path: `buildChatModel`'s `case "azure"` now speaks the Responses API and lifts a
    // configured effort out of modelKwargs into `reasoning.effort` itself — a leaked
    // `modelKwargs.reasoning_effort` there would be an unknown Responses parameter, not a
    // rejected one. Ignored for non-reasoning models.
    const visionModelLower = (visionConfig.model || "").toLowerCase();
    const isReasoningVisionModel = visionModelLower.includes("gpt-5") || /(^|\/)o\d/.test(visionModelLower);
    // Config-sourced, so validated exactly like the chat tiers' effort — the vision
    // block reads its own `VISION_REASONING_EFFORT` and is just as typo-prone.
    const visionEffort = normaliseConfiguredReasoningEffort(visionConfig.reasoningEffort);
    const modelKwargs = isReasoningVisionModel && visionEffort ? { reasoning_effort: visionEffort } : undefined;

    return this.buildChatModel(visionConfig, {
      temperature,
      credentialFileTag: "vision",
      modelKwargs,
      // Absent on the `.env` vision block (it has no such field), so this stays
      // undefined — and today's behaviour — until a DB connection sets it.
      maxOutputTokens: visionConfig.maxOutputTokens,
    });
  }

  /**
   * Gets a configured LLM instance for audio operations based on the current config.
   *
   * Supports the same providers as getVisionLLM(): llamacpp/local, openrouter,
   * requesty, vertex, azure. The configured chat model must accept multi-modal
   * `input_audio` content parts in HumanMessage payloads (Gemini 2.5 family,
   * GPT-4o-audio, etc.).
   *
   * @param params.temperature - default 0.1 (deterministic transcription)
   */
  getAudioLLM(params?: { temperature?: number }): BaseChatModel {
    const temperature = params?.temperature ?? 0.1;
    return this.buildChatModel(this.pickCandidate("audio"), { temperature, credentialFileTag: "audio" });
  }

  /**
   * Builds a LangChain chat model from a resolved config block.
   * Single source of truth for the provider switch shared by getLLM /
   * getVisionLLM / getAudioLLM. `credentialFileTag` keeps the per-modality
   * Vertex temp-credential filenames distinct.
   */
  private buildChatModel(
    cfg: {
      provider: string;
      apiKey: string;
      model: string;
      url: string;
      region?: string;
      allowFallbacks?: boolean;
      instance?: string;
      /**
       * IGNORED by the `case "azure"` branch below — it speaks the GA v1
       * Responses surface, which is IMPLICITLY versioned, so no `api-version`
       * is ever sent. Still used by azure embeddings and the transcriber
       * (`ModelService.getTranscriber` / `buildInnerEmbedder`), which stay on
       * their own SDK clients and are unaffected by the Responses move.
       */
      apiVersion?: string;
      googleCredentialsBase64?: string;
    },
    opts: {
      temperature: number;
      maxOutputTokens?: number;
      frequencyPenalty?: number;
      credentialFileTag: "llm" | "vision" | "audio";
      /**
       * @deprecated Use `reasoningEffort: "none"` instead. Kept as a working
       * alias for backward compatibility — a published-library API is never
       * removed.
       */
      disableThinking?: boolean;
      reasoningEffort?: ReasoningEffort;
      // Raw chat-completions modelKwargs (e.g. { reasoning_effort } for gpt-5 /
      // o-series). Merged into the final ChatOpenAI / Azure params.
      modelKwargs?: Record<string, unknown>;
      // Per-ATTEMPT request budget in ms. ChatOpenAI builds its OpenAI client
      // with `maxRetries: 0` and retries through LangChain's AsyncCaller instead,
      // so this bounds each attempt and the retry can still escalate the
      // OpenRouter pin (openRouterEscalatingFetch) onto a healthy provider.
      // Unset leaves the OpenAI SDK's own 600s default — the ten-minute silent
      // stall this exists to prevent.
      timeoutMs?: number;
    },
  ): BaseChatModel {
    const { temperature, maxOutputTokens, frequencyPenalty } = opts;
    // Every model this factory builds is bounded, including the vision/audio
    // tiers that never pass an explicit budget — an unbounded request is the
    // silent-stall bug, whatever the modality.
    const timeoutMs = opts.timeoutMs ?? this.aiConfig?.requestTimeoutMs;
    // Identifies the deployment whose parameter verdicts we learn (see
    // unsupportedParamFetch). Endpoint-qualified: the same model name behind two
    // providers can accept two different parameter sets.
    const modelKey = [cfg.provider, cfg.instance ?? cfg.url, cfg.model].filter(Boolean).join("|");

    // Resolved ONCE, into `llmConfig.modelKwargs`, so every provider branch below
    // picks it up from the same place.
    //
    // It used to be spread into the generic `new ChatOpenAI({...})` at the bottom
    // of this method — which the `azure` branch never reaches, because it returns
    // early. The effect was that `reasoningEffort` was silently dropped on Azure,
    // i.e. on the one provider this project actually runs, while the unit tests
    // (which build an `openrouter` tier) all passed. Any per-request parameter
    // added here must go into `llmConfig`, never into a single branch's return.
    const effort = opts.reasoningEffort ?? (opts.disableThinking ? "none" : undefined);
    const modelKwargs = {
      ...(opts.modelKwargs ?? {}),
      ...(effort ? { reasoning_effort: effort } : {}),
    };

    const llmConfig: LLMParameters = {
      apiKey: cfg.apiKey || "not-needed",
      temperature,
      model: cfg.model || "local-model",
      configuration: {
        baseURL: cfg.url || "http://localhost:8033/v1",
      },
      ...(Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}),
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    };

    switch (cfg.provider) {
      case "llamacpp": {
        llmConfig.apiKey = "not-needed";
        llmConfig.model = "local-model";
        const llamacppUrl = cfg.url || "http://localhost:8033/v1";
        validateAiUrl(llamacppUrl, cfg.provider);
        llmConfig.configuration.baseURL = llamacppUrl;
        break;
      }

      case "openrouter": {
        const openrouterUrl = cfg.url || "https://openrouter.ai/api/v1";
        validateAiUrl(openrouterUrl, cfg.provider);
        llmConfig.configuration.baseURL = openrouterUrl;
        if (cfg.region) {
          // Escalating pin: attempt 1 honours the configured pin, retries allow fallbacks.
          // The fetch injects the full provider block (order + allow_fallbacks + require_parameters),
          // so it is no longer set via modelKwargs.
          llmConfig.configuration.fetch = openRouterEscalatingFetch(cfg.region, cfg.allowFallbacks ?? true);
        }
        break;
      }

      case "requesty":
        validateAiUrl(cfg.url, cfg.provider);
        llmConfig.configuration.baseURL = cfg.url;
        break;

      case "ollama": {
        // Ollama exposes an OpenAI-compatible API. Unlike `llamacpp`, the model
        // name matters (e.g. "gemma3:12b"), so keep cfg.model. The API key is
        // ignored by Ollama; "not-needed" satisfies the OpenAI client.
        llmConfig.apiKey = "not-needed";
        const ollamaUrl = cfg.url || "http://localhost:11434/v1";
        validateAiUrl(ollamaUrl, cfg.provider);
        llmConfig.configuration.baseURL = ollamaUrl;
        break;
      }

      case "vertex": {
        // Match the proven app-local behaviour (apps/api .../core/llm/services/model.service.ts):
        // write the service-account creds to a temp file, point GOOGLE_APPLICATION_CREDENTIALS
        // at it, and LEAVE it set. GoogleAuth resolves the project id lazily on the FIRST
        // request, so the env var must still be present then — do NOT restore/delete it.
        if (cfg.googleCredentialsBase64) {
          const credentialsJson = Buffer.from(cfg.googleCredentialsBase64, "base64").toString("utf-8");
          const credsPath = writeGcpCredentials(credentialsJson, opts.credentialFileTag);
          // WRITE, not a config read: the Google auth library discovers the
          // service-account file through this process variable, so exporting it
          // is the only way to hand it the credentials we just materialised.
          process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
        }
        // Reasoning effort on Vertex.
        //
        // `llmConfig.modelKwargs` (where `reasoning_effort` was resolved above)
        // reaches only the OpenAI-compatible clients — this branch returns its own
        // client and never sees it, so a configured `AI_REASONING_EFFORT` used to
        // be dropped here without a word. That is the same defect the comment on
        // `modelKwargs` records for the azure branch, and it is why a cost-test run
        // pinned at `low` was actually measured at the model's default.
        //
        // Two conditions, both required, so this is strictly ADDITIVE — a tier that
        // configures no effort, or runs a pre-3 Gemini, builds exactly the request
        // it built before:
        //   1. an effort is explicitly configured or passed, and
        //   2. the model understands `thinkingLevel` (Gemini 3+). Sending it to an
        //      earlier model is an ERROR, not a no-op, so `gemini-2.5-*` tiers must
        //      never receive it.
        const thinkingLevel =
          effort && supportsGeminiThinkingLevel(cfg.model) ? toGeminiThinkingLevel(effort) : undefined;
        return new ChatVertexAI({
          model: cfg.model,
          temperature,
          location: cfg.region,
          // `region` accepts a region ("europe-west4"), a jurisdictional
          // multi-region ("eu"/"us"), or "global". LangChain only builds the
          // first and third correctly — see vertexLocationParams.
          ...vertexLocationParams(cfg.region),
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
      }

      case "azure": {
        // Azure's GA v1 surface: {instance}.openai.azure.com/openai/v1 with
        // implicit versioning (cfg.apiVersion is deliberately unused) and the
        // deployment name in the body's `model`. The branch speaks the
        // RESPONSES API, not chat-completions: gpt-5.6-luna rejects function
        // tools combined with reasoning_effort on /chat/completions ("Please
        // use /v1/responses instead", probed 2026-08-17), and new-model
        // capabilities land on Responses first. Design + live probes:
        // docs/superpowers/specs/2026-08-18-azure-responses-api-design.md.
        //
        // The v1 baseURL below is BUILT from cfg.instance — the old
        // AzureChatOpenAI construction threw on a missing instance (it needs
        // `azureOpenAIApiInstanceName`); this branch must not regress to a
        // silent `https://undefined.openai.azure.com/...` ENOTFOUND.
        if (!cfg.instance) {
          throw new Error(
            "Azure provider requires AI_INSTANCE (or the tier's instance): the v1 baseURL is built from it",
          );
        }
        //
        // The resolved effort travels as `reasoning: { effort }` — the
        // Responses spelling — and must NOT stay in modelKwargs, because
        // ChatOpenAIResponses spreads modelKwargs into the request body
        // verbatim and `reasoning_effort` is not a Responses parameter.
        // Destructuring also lifts out the vision tier's config-sourced
        // effort, which arrives via opts.modelKwargs rather than
        // opts.reasoningEffort.
        const { reasoning_effort: azureEffort, ...azureModelKwargs } = (llmConfig.modelKwargs ?? {}) as Record<
          string,
          unknown
        >;
        return new ChatOpenAIResponses({
          apiKey: cfg.apiKey,
          model: cfg.model,
          temperature,
          ...(timeoutMs ? { timeout: timeoutMs } : {}),
          ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}),
          // `none` vs `minimal` is generation-split (luna: none, nano:
          // minimal) — sent as-is; a mismatch is repaired by the
          // VALUE_SUCCESSORS substitution in unsupportedParamFetch.
          ...(azureEffort ? { reasoning: { effort: azureEffort as OpenAI.Reasoning["effort"] } } : {}),
          ...(Object.keys(azureModelKwargs).length > 0 ? { modelKwargs: azureModelKwargs } : {}),
          // Responses is server-stateful by default (30-day retention).
          // zdrEnabled sends store:false and keeps reasoning items
          // client-side — deliberate posture for legal-domain traffic.
          zdrEnabled: true,
          // Parity with the generic branch below: 1 hard attempt + 2 soft
          // retries through LangChain's AsyncCaller.
          maxRetries: 2,
          configuration: {
            baseURL: `https://${cfg.instance}.openai.azure.com/openai/v1`,
            fetch: unsupportedParamFetch(modelKey),
          },
        });
      }

      default:
        // Any other provider (opencode, openai, groq, a custom gateway…) is
        // treated as a generic OpenAI-compatible endpoint when a base URL is
        // configured — same rule streamCall/streamText already apply. The named
        // cases above exist only where a provider needs special handling.
        if (!cfg.url) {
          throw new Error(
            `Unsupported LLM provider "${cfg.provider}": set its AI_URL (with the matching tier suffix) to use it as an OpenAI-compatible endpoint`,
          );
        }
        validateAiUrl(cfg.url, cfg.provider);
        llmConfig.configuration.baseURL = cfg.url;
        break;
    }

    return new ChatOpenAI({
      ...llmConfig,
      configuration: {
        ...llmConfig.configuration,
        // Wraps whatever the provider switch installed (the OpenRouter pin
        // included) rather than replacing it. `reasoningContentFetch` sits
        // OUTERMOST so it inspects the response that actually comes back —
        // after `unsupportedParamFetch` has finished its repair round-trips.
        fetch: reasoningContentFetch(unsupportedParamFetch(modelKey, llmConfig.configuration.fetch)),
      },
      // 1 hard attempt + 2 soft retries. Retries escalate the OpenRouter pin
      // (see openRouterEscalatingFetch) so a transient provider error can reroute.
      maxRetries: 2,
      ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}),
      // A positive frequency penalty discourages the token-level repetition loops
      // local models fall into on forced tool calls at temperature 0 (e.g. the
      // memory extractor emitting `{op:"ADD",...}` endlessly). Maps to OpenAI's
      // `frequency_penalty`, honoured by the Ollama/llamacpp OpenAI-compatible APIs.
      ...(typeof frequencyPenalty === "number" ? { frequencyPenalty } : {}),
    });
  }

  /**
   * Returns the embedder used for vectorisation. Three layers, all additive over
   * the raw provider embedder:
   *   1. MOCK_AI → a zero-vector embedder (no provider call), sized to
   *      `embedder.dimensions` so downstream vector writes still have the right shape.
   *   2. When `embedder.rateLimit` is configured AND the token bucket is wired,
   *      the provider embedder is wrapped in a RateLimitedEmbedder (distributed
   *      token bucket + local concurrency gate + 429 handling) and CACHED on the
   *      instance, so every caller shares one bucket/gate.
   *   3. Otherwise the raw provider embedder is returned unchanged.
   */
  getEmbedder(): EmbeddingsInterface {
    if (this.aiConfig.mock) {
      const dim = this.aiConfig.embedder.dimensions;
      const zero = (): number[] => new Array(dim).fill(0);
      return {
        embedDocuments: async (texts: string[]) => texts.map(zero),
        embedQuery: async () => zero(),
      };
    }

    const rateLimit = this.aiConfig.embedder.rateLimit;
    const candidate = this.pickCandidate("embedder");
    if (rateLimit && this.bucket && this.logger) {
      // Memoised per CONNECTION: an admin editing the embedder connection must
      // take effect on the next call, not on the next process restart.
      if (this.cachedEmbedder && this.cachedEmbedderConnectionId === candidate.connectionId) return this.cachedEmbedder;
      const inner = this.buildInnerEmbedder(candidate) as Embeddings;
      this.cachedEmbedder = new RateLimitedEmbedder(inner, this.bucket, rateLimit, this.logger);
      this.cachedEmbedderConnectionId = candidate.connectionId;
      return this.cachedEmbedder;
    }

    return this.buildInnerEmbedder(candidate);
  }

  /**
   * Builds the raw provider embedder for one resolved candidate. `dimensions`
   * falls back to the `.env` embedder block when the candidate does not carry
   * one, so a DB connection that omits it keeps today's vector size.
   */
  private buildInnerEmbedder(candidate?: ResolvedAiCandidate): EmbeddingsInterface {
    let response: EmbeddingsInterface;

    const embedderConfig = candidate ?? this.pickCandidate("embedder");
    const dimensions = embedderConfig.dimensions ?? this.aiConfig.embedder?.dimensions;

    switch (embedderConfig.provider) {
      case "local":
        throw new Error("Local embedder is not supported");
      case "openrouter":
        response = new OpenAIEmbeddings({
          openAIApiKey: embedderConfig.apiKey,
          model: embedderConfig.model,
          configuration: {
            baseURL: embedderConfig.url,
          },
        });
        break;
      case "requesty":
        response = new OpenAIEmbeddings({
          openAIApiKey: embedderConfig.apiKey,
          model: embedderConfig.model,
          dimensions: dimensions,
          configuration: {
            baseURL: embedderConfig.url,
          },
        });
        break;
      case "openai":
        response = new OpenAIEmbeddings({
          openAIApiKey: embedderConfig.apiKey,
          model: embedderConfig.model,
        });
        break;
      case "azure":
        response = new AzureOpenAIEmbeddings({
          azureOpenAIApiKey: embedderConfig.apiKey,
          azureOpenAIApiInstanceName: embedderConfig.instance,
          azureOpenAIApiDeploymentName: embedderConfig.model,
          azureOpenAIApiVersion: embedderConfig.apiVersion,
          batchSize: 100,
        });
        break;
      case "vertex": {
        // Google Vertex AI Embeddings (uses embedder-specific credentials).
        // Match app-local behaviour: set GOOGLE_APPLICATION_CREDENTIALS and LEAVE it set
        // (the project id is resolved lazily at request time — do NOT restore/delete it).
        if (embedderConfig.googleCredentialsBase64) {
          const credentialsJson = Buffer.from(embedderConfig.googleCredentialsBase64, "base64").toString("utf-8");
          const credsPath = writeGcpCredentials(credentialsJson, "embedder");
          // WRITE, not a config read: the Google auth library discovers the
          // service-account file through this process variable, so exporting it
          // is the only way to hand it the credentials we just materialised.
          process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
        }

        response = new VertexAIEmbeddings({
          model: embedderConfig.model,
          location: embedderConfig.region,
          // EMBEDDER_REGION accepts a region or a multi-region, same as AI_REGION.
          ...vertexLocationParams(embedderConfig.region),
          dimensions: dimensions,
        });
        break;
      }
    }

    return response;
  }

  getEmbedderDimensions(): number {
    return this.pickCandidate("embedder").dimensions ?? this.aiConfig.embedder.dimensions;
  }

  /**
   * Builds an OpenAI / Azure OpenAI SDK client for audio transcription. This is
   * the SDK-based path (`audio.transcriptions.create`), distinct from
   * AudioLLMService (chat-LLM / OpenAI-style /audio/transcriptions HTTP). Driven
   * by the `transcriber` config block (TRANSCRIBER_* env vars).
   */
  getTranscriber(): OpenAI | AzureOpenAI {
    const transcriber = this.pickCandidate("transcriber");
    switch (transcriber.provider) {
      case "openai":
        return new OpenAI({ apiKey: transcriber.apiKey });
      case "azure":
        return new AzureOpenAI({
          apiKey: transcriber.apiKey,
          apiVersion: transcriber.apiVersion,
          endpoint: transcriber.url,
          deployment: transcriber.model,
        });
      default:
        throw new Error(`Unsupported transcriber provider: ${transcriber.provider}`);
    }
  }

  async transcribeAudio(params: { filePath: string; prompt: string; language?: string }): Promise<unknown> {
    // Same candidate the client above was built from — reading the model from
    // config while the client came from a DB connection would mix two chains.
    return await this.getTranscriber().audio.transcriptions.create({
      file: fs.createReadStream(params.filePath),
      model: this.pickCandidate("transcriber").model,
      prompt: params.prompt,
      response_format: "json",
    });
  }
}
