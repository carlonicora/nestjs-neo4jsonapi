import { forwardRef, Module } from "@nestjs/common";
import { LLMModule } from "../../core/llm/llm.module";
import { AssistantModule } from "../../foundations/assistant/assistant.module";
import { ContextualiserModule } from "../contextualiser/contextualiser.module";
import { DriftModule } from "../drift/drift.module";
import { GraphModule } from "../graph/graph.module";
import { OperatorController } from "./controllers/operator.controller";
import { OperatorCheckpointerService } from "./services/operator.checkpointer.service";
import { OperatorService } from "./services/operator.service";
import { OperatorTestActionTool } from "./tools/operator-test-action.tool";
import { OperatorToolRegistry } from "./tools/operator.tool.registry";
import { SearchCommunitiesTool } from "./tools/search-communities.tool";
import { SearchDocumentsTool } from "./tools/search-documents.tool";

@Module({
  // forwardRef: OperatorController needs AssistantService (operator turn
  // orchestration) while AssistantModule imports this module for
  // OperatorService — the cycle requires forwardRef on both sides.
  imports: [LLMModule, GraphModule, ContextualiserModule, DriftModule, forwardRef(() => AssistantModule)],
  controllers: [OperatorController],
  providers: [
    OperatorService,
    OperatorToolRegistry,
    OperatorCheckpointerService,
    SearchDocumentsTool,
    SearchCommunitiesTool,
    OperatorTestActionTool,
  ],
  exports: [OperatorService, OperatorToolRegistry, OperatorCheckpointerService],
})
export class OperatorModule {}
