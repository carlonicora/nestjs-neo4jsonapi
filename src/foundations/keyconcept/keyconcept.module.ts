import { BullModule } from "@nestjs/bullmq";
import { Module, OnModuleInit } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { LLMModule } from "../../core/llm/llm.module";
import { KeyConceptController } from "./controllers/keyconcept.controller";
import { KeyConceptModel } from "./entities/key.concept.model";
import { KEYCONCEPT_EMBEDDING_QUEUE, KeyConceptEmbeddingProcessor } from "./processors/keyconcept.embedding.processor";
import { KeyConceptRepository } from "./repositories/keyconcept.repository";
import { KeyConceptService } from "./services/keyconcept.service";

@Module({
  controllers: [KeyConceptController],
  providers: [KeyConceptRepository, KeyConceptService, createWorkerProvider(KeyConceptEmbeddingProcessor)],
  exports: [KeyConceptRepository, KeyConceptService],
  imports: [LLMModule, BullModule.registerQueue({ name: KEYCONCEPT_EMBEDDING_QUEUE })],
})
export class KeyConceptModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(KeyConceptModel);
  }
}
