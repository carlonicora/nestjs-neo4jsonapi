import { Global, Module } from "@nestjs/common";
import { TokenUsageModule } from "../../foundations/tokenusage/tokenusage.module";
import { AudioLLMService } from "./services/audio.llm.service";
import { EmbedderService } from "./services/embedder.service";
import { LLMCacheService } from "./services/llm-cache.service";
import { LLMCallDumper } from "./services/llm-call-dumper.service";
import { LLMService } from "./services/llm.service";
import { ModelService } from "./services/model.service";
import { VisionLLMService } from "./services/vision.llm.service";

const LLM_SERVICES = [
  LLMService,
  ModelService,
  EmbedderService,
  VisionLLMService,
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
  imports: [TokenUsageModule],
  providers: LLM_SERVICES,
  exports: LLM_SERVICES,
})
export class LLMModule {}
