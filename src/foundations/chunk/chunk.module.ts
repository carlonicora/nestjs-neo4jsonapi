import { BullModule } from "@nestjs/bullmq";
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
import { ChunkEmbeddingProcessor } from "./processors/chunk.embedding.processor";
import { ChunkProcessor } from "./processors/chunk.processor";
import { ChunkRepository } from "./repositories/chunk.repository";
import { ChunkService } from "./services/chunk.service";

/**
 * ChunkModule - Handles document chunking and graph generation.
 *
 * The content-processing queue (CHUNK) is provided by the @Global QueueModule.
 * The embedding-rebuild queues backing ChunkController's @InjectQueue() and the
 * ChunkEmbeddingProcessor are registered LOCALLY here so the module is
 * self-contained — every consuming app (api/corpus/neural-erp/phlow) loads
 * ChunkModule without having to register these queues in its own config, and
 * without declaring the rebuild routes itself (which previously duplicated).
 */
@Module({
  controllers: [ChunkController],
  providers: [
    ChunkDescriptor.model.serialiser,
    ChunkService,
    ChunkRepository,
    createWorkerProvider(ChunkProcessor),
    createWorkerProvider(ChunkEmbeddingProcessor),
  ],
  exports: [ChunkService, ChunkRepository],
  imports: [
    AtomicFactModule,
    GraphCreatorModule,
    KeyConceptModule,
    S3Module,
    LLMModule,
    TokenUsageModule,
    BullModule.registerQueue({ name: "embedding-chunks" }),
    BullModule.registerQueue({ name: "embedding-keyconcepts" }),
  ],
})
export class ChunkModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(ChunkDescriptor.model);
  }
}
