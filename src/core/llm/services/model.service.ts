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
import OpenAI, { AzureOpenAI } from "openai";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";

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

  /**
   * Gets a configured LLM instance based on the current config.
   *
   * Supports multiple providers:
   * - `llamacpp`/`local`: Local llama.cpp server (OpenAI-compatible API)
   * - `openrouter`: OpenRouter cloud service
   * - `requesty`: Requesty proxy service
   * - `vertex`: Google Vertex AI (Gemini models)
   * - `azure`: Azure OpenAI Service
   *
   * @param params - Optional parameters
   * @param params.temperature - Temperature for text generation (0-2, default: 0.2)
   *                             Lower = more deterministic, Higher = more creative
   * @param params.maxOutputTokens - Maximum output tokens (default from config)
   * @returns Configured BaseChatModel instance from LangChain
   * @throws {Error} If the configured LLM type is not supported
   */
  getLLM(params?: { temperature?: number; maxOutputTokens?: number }): BaseChatModel {
    const temperature = params?.temperature ?? 0.2;
    const maxOutputTokens = params?.maxOutputTokens ?? this.aiConfig.ai.maxOutputTokens;

    // Base configuration shared by all providers
    const llmConfig: LLMParameters = {
      apiKey: this.aiConfig.ai.apiKey || "not-needed",
      temperature,
      model: this.aiConfig.ai.model || "local-model",
      configuration: {
        baseURL: this.aiConfig.ai.url || "http://localhost:8033/v1",
      },
    };

    // Provider-specific overrides
    switch (this.aiConfig.ai.provider) {
      case "llamacpp":
        // Local models don't need API keys
        llmConfig.apiKey = "not-needed";
        llmConfig.model = "local-model";
        llmConfig.configuration.baseURL = this.aiConfig.ai.url || "http://localhost:8033/v1";
        break;

      case "openrouter":
        // OpenRouter uses configured values with required headers
        llmConfig.configuration.baseURL = this.aiConfig.ai.url || "https://openrouter.ai/api/v1";
        // Add provider routing if region is configured
        if (this.aiConfig.ai.region) {
          llmConfig.modelKwargs = {
            provider: {
              order: [this.aiConfig.ai.region],
              allow_fallbacks: true,
            },
          };
        }
        break;

      case "requesty":
        // Requesty uses configured values (JSON mode is used for structured output instead of function calling)
        llmConfig.configuration.baseURL = this.aiConfig.ai.url;
        break;

      case "vertex": {
        // Google Vertex AI (Gemini models)
        // Project ID is automatically extracted from the service account credentials JSON
        const googleConfig = this.aiConfig.ai;

        // Decode base64 credentials and write to temp file if provided
        if (googleConfig.googleCredentialsBase64) {
          const credentialsJson = Buffer.from(googleConfig.googleCredentialsBase64, "base64").toString("utf-8");
          const tempCredPath = path.join(os.tmpdir(), "gcp-credentials-llm.json");
          fs.writeFileSync(tempCredPath, credentialsJson, { mode: 0o600 });
          process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredPath;
        }

        return new ChatVertexAI({
          model: googleConfig.model,
          temperature: temperature,
          location: googleConfig.region,
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
        });
      }

      case "azure": {
        const azureParameters: any = {
          azureOpenAIApiKey: this.aiConfig.ai.apiKey,
          azureOpenAIApiInstanceName: this.aiConfig.ai.instance,
          azureOpenAIApiDeploymentName: this.aiConfig.ai.model,
          azureOpenAIApiVersion: this.aiConfig.ai.apiVersion,
          temperature,
          ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}),
        };

        return new AzureChatOpenAI(azureParameters);
      }

      default:
        throw new Error(`Unsupported LLM type: ${this.aiConfig.ai.provider}`);
    }

    // Create new model instance
    return new ChatOpenAI({ ...llmConfig, ...(maxOutputTokens ? { maxTokens: maxOutputTokens } : {}) });
  }

  /**
   * Gets a configured LLM instance for vision operations based on the current config.
   *
   * Supports multiple providers:
   * - `llamacpp`/`local`: Local llama.cpp server (OpenAI-compatible API)
   * - `openrouter`: OpenRouter cloud service
   * - `requesty`: Requesty service
   * - `vertex`: Google Vertex AI (Gemini models)
   *
   * @param params - Optional parameters
   * @param params.temperature - Temperature for text generation (0-2, default: 0.1)
   * @returns Configured BaseChatModel instance from LangChain
   * @throws {Error} If the configured LLM type is not supported
   */
  getVisionLLM(params?: { temperature?: number }): BaseChatModel {
    const temperature = params?.temperature ?? 0.1;

    // Base configuration shared by all providers
    const llmConfig: LLMParameters = {
      apiKey: this.visionConfig.apiKey || "not-needed",
      temperature,
      model: this.visionConfig.model || "local-model",
      configuration: {
        baseURL: this.visionConfig.url || "http://localhost:8033/v1",
      },
    };

    // Provider-specific overrides
    switch (this.visionConfig.provider) {
      case "llamacpp":
        llmConfig.apiKey = "not-needed";
        llmConfig.model = "local-model";
        llmConfig.configuration.baseURL = this.visionConfig.url || "http://localhost:8033/v1";
        break;

      case "openrouter":
        llmConfig.configuration.baseURL = this.visionConfig.url || "https://openrouter.ai/api/v1";
        if (this.visionConfig.region) {
          llmConfig.modelKwargs = {
            provider: {
              order: [this.visionConfig.region],
              allow_fallbacks: true,
            },
          };
        }
        break;

      case "requesty":
        llmConfig.configuration.baseURL = this.visionConfig.url;
        break;

      case "vertex": {
        const googleConfig = this.visionConfig;

        if (googleConfig.googleCredentialsBase64) {
          const credentialsJson = Buffer.from(googleConfig.googleCredentialsBase64, "base64").toString("utf-8");
          const tempCredPath = path.join(os.tmpdir(), "gcp-credentials-vision.json");
          fs.writeFileSync(tempCredPath, credentialsJson, { mode: 0o600 });
          process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredPath;
        }

        return new ChatVertexAI({
          model: googleConfig.model,
          temperature: temperature,
          location: googleConfig.region,
        });
      }

      default:
        throw new Error(`Unsupported Vision LLM type: ${this.visionConfig.provider}`);
    }

    // Create new model instance
    return new ChatOpenAI(llmConfig);
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

  getTranscriber(): any {
    let response: any;
    switch (this.aiConfig.transcriber.provider) {
      case "openai":
        response = new OpenAI({
          apiKey: this.aiConfig.transcriber.apiKey,
        });
        break;
      case "azure":
        response = new AzureOpenAI({
          apiKey: this.aiConfig.transcriber.apiKey,
          apiVersion: this.aiConfig.transcriber.apiVersion,
          endpoint: this.aiConfig.transcriber.url,
          deployment: this.aiConfig.transcriber.model,
        });
        break;
    }
    return response;
  }

  getEmbedderDimensions(): number {
    return this.aiConfig.embedder.dimensions;
  }

  async transcribeAudio(params: { filePath: string; prompt: string; language?: string }): Promise<any> {
    return await this.getTranscriber().audio.transcriptions.create({
      file: fs.createReadStream(params.filePath),
      model: this.aiConfig.transcriber.model,
      prompt: params.prompt,
      response_format: "json",
    });
  }
}
