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
import { EmbedderTokenBucketService } from "./embedder-token-bucket.service";
import { openRouterEscalatingFetch } from "./openrouter-fetch";
import { RateLimitedEmbedder } from "./rate-limited-embedder";

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
}

@Injectable()
export class ModelService implements OnModuleInit {
  private cachedEmbedder?: EmbeddingsInterface;

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
    disableThinking?: boolean;
  }): BaseChatModel {
    if (this.aiConfig.mock) {
      return new FakeListChatModel({ responses: ["mock summary"] }) as unknown as BaseChatModel;
    }

    const temperature = params?.temperature ?? 0.2;
    const cfg = this.getResolvedConfig(params?.modelWeight);
    const maxOutputTokens = params?.maxOutputTokens ?? cfg.maxOutputTokens;
    return this.buildChatModel(cfg, {
      temperature,
      maxOutputTokens,
      frequencyPenalty: params?.frequencyPenalty,
      credentialFileTag: "llm",
      disableThinking: params?.disableThinking,
    });
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
    const modelKwargs =
      isReasoningVisionModel && visionConfig.reasoningEffort
        ? { reasoning_effort: visionConfig.reasoningEffort }
        : undefined;

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
      disableThinking?: boolean;
      // Raw chat-completions modelKwargs (e.g. { reasoning_effort } for gpt-5 /
      // o-series). Merged into the final ChatOpenAI / Azure params.
      modelKwargs?: Record<string, unknown>;
    },
  ): BaseChatModel {
    const { temperature, maxOutputTokens, frequencyPenalty } = opts;

    const llmConfig: LLMParameters = {
      apiKey: cfg.apiKey || "not-needed",
      temperature,
      model: cfg.model || "local-model",
      configuration: {
        baseURL: cfg.url || "http://localhost:8033/v1",
      },
      ...(opts.modelKwargs ? { modelKwargs: opts.modelKwargs } : {}),
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
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
        });
      }

      case "azure": {
        const azureParameters: any = {
          azureOpenAIApiKey: cfg.apiKey,
          azureOpenAIApiInstanceName: cfg.instance,
          azureOpenAIApiDeploymentName: cfg.model,
          azureOpenAIApiVersion: cfg.apiVersion,
          temperature,
          ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}),
          ...(llmConfig.modelKwargs ? { modelKwargs: llmConfig.modelKwargs } : {}),
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
      // 1 hard attempt + 2 soft retries. Retries escalate the OpenRouter pin
      // (see openRouterEscalatingFetch) so a transient provider error can reroute.
      maxRetries: 2,
      ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}),
      // A positive frequency penalty discourages the token-level repetition loops
      // local models fall into on forced tool calls at temperature 0 (e.g. the
      // memory extractor emitting `{op:"ADD",...}` endlessly). Maps to OpenAI's
      // `frequency_penalty`, honoured by the Ollama/llamacpp OpenAI-compatible APIs.
      ...(typeof frequencyPenalty === "number" ? { frequencyPenalty } : {}),
      ...(opts.disableThinking ? { modelKwargs: { ...(llmConfig.modelKwargs ?? {}), reasoning_effort: "none" } } : {}),
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
