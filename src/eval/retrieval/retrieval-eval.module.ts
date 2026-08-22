import { Module } from "@nestjs/common";
import { ResponderModule } from "../../agents/responder/responder.module";
import { LLMModule } from "../../core/llm/llm.module";
import { ChunkModule } from "../../foundations/chunk/chunk.module";
import { EndToEndSweepService } from "./end-to-end-sweep.service";
import { EvidenceMatcher } from "./evidence.matcher";
import { QuestionSetLoader } from "./question-set.loader";
import { RetrievalSweepService } from "./retrieval-sweep.service";
import { RubricJudgeService } from "./rubric-judge.service";
import { TokenAccountingChecker } from "./token-accounting.check";

/**
 * Evaluation tooling. NOT imported by AgentsModule or by bootstrap — a product
 * that never runs a sweep must not pay for this module's dependency graph.
 * Import it explicitly from a sweep entrypoint.
 *
 * The three imports carry exactly the providers this module's services inject:
 * `LLMModule` exports `LLMService` (RubricJudgeService), `ChunkModule` exports
 * `ChunkRepository` (RetrievalSweepService) and `ResponderModule` exports
 * `ResponderService` (EndToEndSweepService). `TokenAccountingChecker`,
 * `EvidenceMatcher` and `QuestionSetLoader` have no injected dependencies.
 */
@Module({
  imports: [LLMModule, ChunkModule, ResponderModule],
  providers: [
    QuestionSetLoader,
    EvidenceMatcher,
    RetrievalSweepService,
    EndToEndSweepService,
    RubricJudgeService,
    TokenAccountingChecker,
  ],
  exports: [QuestionSetLoader, RetrievalSweepService, EndToEndSweepService],
})
export class RetrievalEvalModule {}
