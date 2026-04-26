import { Module, OnModuleInit } from "@nestjs/common";
import { GraphCreatorModule } from "../../agents/graph.creator/graph.creator.module";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { LLMModule } from "../../core/llm/llm.module";
import { AtomicFactModule } from "../atomicfact/atomicfact.module";
import { KeyConceptModule } from "../keyconcept/keyconcept.module";
import { S3Module } from "../s3/s3.module";
import { TokenUsageModule } from "../tokenusage/tokenusage.module";
import { ChunkController } from "./controllers/chunk.controller";
import { ChunkDescriptor } from "./entities/chunk.entity";
import { ChunkProcessor } from "./processors/chunk.processor";
import { ChunkRepository } from "./repositories/chunk.repository";
import { ChunkService } from "./services/chunk.service";

/**
 * ChunkModule - Handles document chunking and graph generation.
 *
 * This is a fully static module. Queue registration is handled centrally
 * by QueueModule (which is @Global), so ChunkProcessor can inject queues
 * via @InjectQueue() without needing to register them here.
 */
@Module({
  controllers: [ChunkController],
  providers: [ChunkDescriptor.model.serialiser, ChunkService, ChunkRepository, createWorkerProvider(ChunkProcessor)],
  exports: [ChunkService, ChunkRepository],
  imports: [AtomicFactModule, GraphCreatorModule, KeyConceptModule, S3Module, LLMModule, TokenUsageModule],
})
export class ChunkModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(ChunkDescriptor.model);
  }
}
