import { EmbeddingsInterface } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatVertexAI, VertexAIEmbeddings } from "@langchain/google-vertexai";
import { AzureChatOpenAI, AzureOpenAIEmbeddings, ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { ModelWeight } from "../enums/model.weight";

interface LLMParameters {
  apiKey: string;
  temperature: number;
  model: string;
  configuration: {
    baseURL: string;
    defaultHeaders?: Record<string, string>;
  };
  modelKwargs?: Record<string, unknown>;
}

@Injectable()
export class ModelService {
  constructor(
    private readonly clsService: ClsService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

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
    modelWeight?: ModelWeight;
    disableThinking?: boolean;
  }): BaseChatModel {
    const temperature = params?.temperature ?? 0.2;
    const cfg = this.getResolvedConfig(params?.modelWeight);
    const maxOutputTokens = params?.maxOutputTokens ?? cfg.maxOutputTokens;
    return this.buildChatModel(cfg, {
      temperature,
      maxOutputTokens,
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
    const temperature = params?.temperature ?? 0.1;
    return this.buildChatModel(this.visionConfig, { temperature, credentialFileTag: "vision" });
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
      instance?: string;
      apiVersion?: string;
      googleCredentialsBase64?: string;
    },
    opts: {
      temperature: number;
      maxOutputTokens?: number;
      credentialFileTag: "llm" | "vision" | "audio";
      disableThinking?: boolean;
    },
  ): BaseChatModel {
    const { temperature, maxOutputTokens } = opts;

    const llmConfig: LLMParameters = {
      apiKey: cfg.apiKey || "not-needed",
      temperature,
      model: cfg.model || "local-model",
      configuration: {
        baseURL: cfg.url || "http://localhost:8033/v1",
      },
    };

    switch (cfg.provider) {
      case "llamacpp":
        llmConfig.apiKey = "not-needed";
        llmConfig.model = "local-model";
        llmConfig.configuration.baseURL = cfg.url || "http://localhost:8033/v1";
        break;

      case "openrouter":
        llmConfig.configuration.baseURL = cfg.url || "https://openrouter.ai/api/v1";
        if (cfg.region) {
          llmConfig.modelKwargs = {
            provider: { order: [cfg.region], allow_fallbacks: true },
          };
        }
        break;

      case "requesty":
        llmConfig.configuration.baseURL = cfg.url;
        break;

      case "ollama":
        // Ollama exposes an OpenAI-compatible API. Unlike `llamacpp`, the model
        // name matters (e.g. "gemma3:12b"), so keep cfg.model. The API key is
        // ignored by Ollama; "not-needed" satisfies the OpenAI client.
        llmConfig.apiKey = "not-needed";
        llmConfig.configuration.baseURL = cfg.url || "http://localhost:11434/v1";
        break;

      case "vertex": {
        if (cfg.googleCredentialsBase64) {
          const credentialsJson = Buffer.from(cfg.googleCredentialsBase64, "base64").toString("utf-8");
          const tempCredPath = path.join(os.tmpdir(), `gcp-credentials-${opts.credentialFileTag}.json`);
          fs.writeFileSync(tempCredPath, credentialsJson, { mode: 0o600 });
          process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredPath;
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
        llmConfig.configuration.baseURL = cfg.url;
        break;
    }

    return new ChatOpenAI({
      ...llmConfig,
      ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}),
      ...(opts.disableThinking ? { modelKwargs: { ...(llmConfig.modelKwargs ?? {}), reasoning_effort: "none" } } : {}),
    });
  }

  getEmbedder(): EmbeddingsInterface {
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
        // Google Vertex AI Embeddings (uses embedder-specific credentials)
        const embedderConfig = this.aiConfig.embedder;

        if (embedderConfig.googleCredentialsBase64) {
          const credentialsJson = Buffer.from(embedderConfig.googleCredentialsBase64, "base64").toString("utf-8");
          const tempCredPath = path.join(os.tmpdir(), "gcp-credentials-embedder.json");
          fs.writeFileSync(tempCredPath, credentialsJson, { mode: 0o600 });
          process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredPath;
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
}
