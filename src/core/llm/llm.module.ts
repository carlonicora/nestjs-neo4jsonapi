import { Global, Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module";
import { TokenUsageModule } from "../../foundations/tokenusage/tokenusage.module";
import { AudioLLMService } from "./services/audio.llm.service";
import { EmbedderService } from "./services/embedder.service";
import { EmbedderTokenBucketService } from "./services/embedder-token-bucket.service";
import { LLMCacheService } from "./services/llm-cache.service";
import { DocumentAiService } from "./services/document-ai.service";
import { LLMCallDumper } from "./services/llm-call-dumper.service";
import { LLMService } from "./services/llm.service";
import { ModelService } from "./services/model.service";
import { VisionLLMService } from "./services/vision.llm.service";

const LLM_SERVICES = [
  LLMService,
  ModelService,
  EmbedderService,
  EmbedderTokenBucketService,
  VisionLLMService,
  DocumentAiService,
  AudioLLMService,
  LLMCallDumper,
  LLMCacheService,
];

/**
 * LLM Module
 *
 * Provides LLM (Large Language Model) integration services.
 * Configuration is read from `baseConfig.ai` directly.
 *
 * Features:
 * - Multi-provider support (OpenAI, OpenRouter, etc.)
 * - Embeddings generation
 * - Vision/image analysis
 * - Model selection and configuration
 * - Token usage tracking
 * - Optional per-call JSON dumps for debugging (gated by ASSISTANT_DUMP_LLM_CALLS)
 */
@Global()
@Module({
  // RedisModule provides RedisClientStorageService for EmbedderTokenBucketService's
  // distributed token bucket. RedisModule is NOT @Global, so it must be imported here.
  imports: [TokenUsageModule, RedisModule],
  providers: LLM_SERVICES,
  exports: LLM_SERVICES,
})
export class LLMModule {}
