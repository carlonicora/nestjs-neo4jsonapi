import { Module } from "@nestjs/common";
import { ContextualiserContextFactoryService } from "./factories/contextualiser.context.factory";
import { AtomicFactsNodeService } from "./nodes/atomicfacts.node.service";
import { ChunkNodeService } from "./nodes/chunk.node.service";
import { ChunkVectorNodeService } from "./nodes/chunk.vector.node.service";
import { KeyConceptsNodeService } from "./nodes/keyconcepts.node.service";
import { QuestionRefinerNodeService } from "./nodes/question.refiner.node.service";
import { RationalNodeService } from "./nodes/rational.node.service";
import { ContextualiserService } from "./services/contextualiser.service";
import { LLMModule } from "../../core/llm/llm.module";
import { AtomicFactModule } from "../../foundations/atomicfact/atomicfact.module";
import { ChunkModule } from "../../foundations/chunk/chunk.module";
// NOTE: CompanyModule is deliberately NOT imported — see the note in
// responder.module.ts. Nothing here injects CompanyService/CompanyRepository,
// and importing it would mount CompanyController into every consumer.
import { KeyConceptModule } from "../../foundations/keyconcept/keyconcept.module";
import { S3Module } from "../../foundations/s3/s3.module";

@Module({
  imports: [LLMModule, S3Module, AtomicFactModule, KeyConceptModule, ChunkModule],
  providers: [
    ContextualiserContextFactoryService,
    ContextualiserService,
    AtomicFactsNodeService,
    ChunkNodeService,
    KeyConceptsNodeService,
    RationalNodeService,
    QuestionRefinerNodeService,
    ChunkVectorNodeService,
  ],
  exports: [ContextualiserContextFactoryService, ContextualiserService],
})
export class ContextualiserModule {}
