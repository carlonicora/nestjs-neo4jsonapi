import { Embeddings, EmbeddingsInterface } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { ChatVertexAI, VertexAIEmbeddings } from "@langchain/google-vertexai";
import { AzureChatOpenAI, AzureOpenAIEmbeddings, ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ClsService } from "nestjs-cls";
import OpenAI, { AzureOpenAI } from "openai";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { AppLoggingService } from "../../logging/services/logging.service";
import { ModelWeight } from "../enums/model.weight";
import { ReasoningEffort } from "../enums/reasoning.effort";
import { vertexLocationParams } from "../utils/vertex.utils";
import { EmbedderTokenBucketService } from "./embedder-token-bucket.service";
import { openRouterEscalatingFetch } from "./openrouter-fetch";
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
  const allowlistRaw = process.env.AI_URL_ALLOWLIST;
  if (allowlistRaw) {
    const allowlist = allowlistRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
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

@Injectable()
export class ModelService implements OnModuleInit {
  private cachedEmbedder?: EmbeddingsInterface;

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
  ) {}

  /**
   * Fail-closed MOCK_AI safety gate. MOCK_AI returns synthetic data (no provider
   * call) for every model/embedder/structured call — invaluable for local dev and
   * tests, catastrophic in production (it would write fake AI data into the graph).
   * This refuses to start when MOCK_AI is on AND the environment is production.
   * Reads `process.env.ENV` directly on purpose: a fail-closed safety gate must not
   * depend on config wiring being correct.
   */
  onModuleInit(): void {
    if (this.aiConfig.mock && process.env.ENV === "production") {
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
   * Resolves the AI config block for a model weight.
   * Undefined / Normal → `ai`; Lite → `aiLite`; Large → `aiLarge`.
   */
  getResolvedConfig(weight?: ModelWeight): ConfigAiInterface["ai"] {
    switch (weight) {
      case ModelWeight.Lite:
        return this.aiConfig.aiLite;
      case ModelWeight.Large:
        return this.aiConfig.aiLarge;
      default:
        return this.aiConfig.ai;
    }
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
   * - `azure`: Azure OpenAI Service
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
  }): BaseChatModel {
    if (this.aiConfig.mock) {
      return new FakeListChatModel({ responses: ["mock summary"] }) as unknown as BaseChatModel;
    }

    const temperature = params?.temperature ?? 0.2;
    const cfg = this.getResolvedConfig(params?.modelWeight);
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
    const cacheKey = [
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
   * - `azure`: Azure OpenAI Service
   *
   * @param params - Optional parameters
   * @param params.temperature - Temperature for text generation (0-2, default: 0.1)
   * @returns Configured BaseChatModel instance from LangChain
   * @throws {Error} If the configured LLM type is not supported
   */
  getVisionLLM(params?: { temperature?: number }): BaseChatModel {
    if (this.aiConfig.mock) {
      return new FakeListChatModel({ responses: ["mock summary"] }) as unknown as BaseChatModel;
    }

    const temperature = params?.temperature ?? 0.1;
    const visionConfig = this.visionConfig;

    // Reasoning models (gpt-5 / o-series) accept `reasoning_effort` on the chat-completions
    // call. Lower effort = far fewer reasoning tokens = much faster. Passed via modelKwargs
    // (raw param) because the LangChain `reasoning` object is rejected by Azure chat-completions
    // deployments. Ignored for non-reasoning models.
    const visionModelLower = (visionConfig.model || "").toLowerCase();
    const isReasoningVisionModel = visionModelLower.includes("gpt-5") || /(^|\/)o\d/.test(visionModelLower);
    // Config-sourced, so validated exactly like the chat tiers' effort — the vision
    // block reads its own `VISION_REASONING_EFFORT` and is just as typo-prone.
    const visionEffort = normaliseConfiguredReasoningEffort(visionConfig.reasoningEffort);
    const modelKwargs = isReasoningVisionModel && visionEffort ? { reasoning_effort: visionEffort } : undefined;

    return this.buildChatModel(visionConfig, { temperature, credentialFileTag: "vision", modelKwargs });
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
    return this.buildChatModel(this.audioConfig, { temperature, credentialFileTag: "audio" });
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
          process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
        }
        return new ChatVertexAI({
          model: cfg.model,
          temperature,
          location: cfg.region,
          // `region` accepts a region ("europe-west4"), a jurisdictional
          // multi-region ("eu"/"us"), or "global". LangChain only builds the
          // first and third correctly — see vertexLocationParams.
          ...vertexLocationParams(cfg.region),
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
        });
      }

      case "azure": {
        const azureParameters: any = {
          azureOpenAIApiKey: cfg.apiKey,
          azureOpenAIApiInstanceName: cfg.instance,
          azureOpenAIApiDeploymentName: cfg.model,
          azureOpenAIApiVersion: cfg.apiVersion,
          // The deployment name builds the URL — it never reaches the parameter
          // mapping. Without `model` LangChain falls back to its "gpt-3.5-turbo"
          // default and picks the request shape from THAT, sending `max_tokens`
          // to a gpt-5 deployment (400 — "Use 'max_completion_tokens' instead").
          // Azure ignores the body's `model`, so this is purely a client-side
          // signal about which model the deployment actually serves.
          model: cfg.model,
          temperature,
          ...(timeoutMs ? { timeout: timeoutMs } : {}),
          ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}),
          ...(llmConfig.modelKwargs ? { modelKwargs: llmConfig.modelKwargs } : {}),
          // ONLY `fetch` — a `baseURL` here would override the Azure endpoint
          // that azureOpenAIApiInstanceName/DeploymentName build.
          configuration: { fetch: unsupportedParamFetch(modelKey) },
        };
        return new AzureChatOpenAI(azureParameters);
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
        // included) rather than replacing it.
        fetch: unsupportedParamFetch(modelKey, llmConfig.configuration.fetch),
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
    if (rateLimit && this.bucket && this.logger) {
      if (this.cachedEmbedder) return this.cachedEmbedder;
      const inner = this.buildInnerEmbedder() as Embeddings;
      this.cachedEmbedder = new RateLimitedEmbedder(inner, this.bucket, rateLimit, this.logger);
      return this.cachedEmbedder;
    }

    return this.buildInnerEmbedder();
  }

  private buildInnerEmbedder(): EmbeddingsInterface {
    let response: EmbeddingsInterface;

    switch (this.aiConfig.embedder.provider) {
      case "local":
        throw new Error("Local embedder is not supported");
      case "openrouter":
        response = new OpenAIEmbeddings({
          openAIApiKey: this.aiConfig.embedder.apiKey,
          model: this.aiConfig.embedder.model,
          configuration: {
            baseURL: this.aiConfig.embedder.url,
          },
        });
        break;
      case "requesty":
        response = new OpenAIEmbeddings({
          openAIApiKey: this.aiConfig.embedder.apiKey,
          model: this.aiConfig.embedder.model,
          dimensions: this.aiConfig.embedder.dimensions,
          configuration: {
            baseURL: this.aiConfig.embedder.url,
          },
        });
        break;
      case "openai":
        response = new OpenAIEmbeddings({
          openAIApiKey: this.aiConfig.embedder.apiKey,
          model: this.aiConfig.embedder.model,
        });
        break;
      case "azure":
        response = new AzureOpenAIEmbeddings({
          azureOpenAIApiKey: this.aiConfig.embedder.apiKey,
          azureOpenAIApiInstanceName: this.aiConfig.embedder.instance,
          azureOpenAIApiDeploymentName: this.aiConfig.embedder.model,
          azureOpenAIApiVersion: this.aiConfig.embedder.apiVersion,
          batchSize: 100,
        });
        break;
      case "vertex": {
        // Google Vertex AI Embeddings (uses embedder-specific credentials).
        // Match app-local behaviour: set GOOGLE_APPLICATION_CREDENTIALS and LEAVE it set
        // (the project id is resolved lazily at request time — do NOT restore/delete it).
        const embedderConfig = this.aiConfig.embedder;

        if (embedderConfig.googleCredentialsBase64) {
          const credentialsJson = Buffer.from(embedderConfig.googleCredentialsBase64, "base64").toString("utf-8");
          const credsPath = writeGcpCredentials(credentialsJson, "embedder");
          process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
        }

        response = new VertexAIEmbeddings({
          model: embedderConfig.model,
          location: embedderConfig.region,
          // EMBEDDER_REGION accepts a region or a multi-region, same as AI_REGION.
          ...vertexLocationParams(embedderConfig.region),
          dimensions: embedderConfig.dimensions,
        });
        break;
      }
    }

    return response;
  }

  getEmbedderDimensions(): number {
    return this.aiConfig.embedder.dimensions;
  }

  /**
   * Builds an OpenAI / Azure OpenAI SDK client for audio transcription. This is
   * the SDK-based path (`audio.transcriptions.create`), distinct from
   * AudioLLMService (chat-LLM / OpenAI-style /audio/transcriptions HTTP). Driven
   * by the `transcriber` config block (TRANSCRIBER_* env vars).
   */
  getTranscriber(): OpenAI | AzureOpenAI {
    const transcriber = this.aiConfig.transcriber;
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
    return await this.getTranscriber().audio.transcriptions.create({
      file: fs.createReadStream(params.filePath),
      model: this.aiConfig.transcriber.model,
      prompt: params.prompt,
      response_format: "json",
    });
  }
}
