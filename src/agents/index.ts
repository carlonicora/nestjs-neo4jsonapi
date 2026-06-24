// Centralized AgentsModule - prompts configured via baseConfig.prompts
export { AgentsModule } from "./agents.modules";

// Default prompts for reference
export * from "./prompts";

// Community Detector (DRIFT)
export { CommunityDetectorModule } from "./community.detector/community.detector.module";
export { CommunityDetectorService } from "./community.detector/services/community.detector.service";

// Community Summariser (DRIFT)
export { CommunitySummariserModule } from "./community.summariser/community.summariser.module";
export { CommunitySummariserService } from "./community.summariser/services/community.summariser.service";

// DRIFT Search
export { DriftModule } from "./drift/drift.module";
export { DriftSearchService, DriftSearchResult, DriftConfig } from "./drift/services/drift.search.service";
export { DriftMigrationService, MigrationResult } from "./drift/services/drift.migration.service";
export { FollowUpAnswer, DriftContextState } from "./drift/contexts/drift.context";

// Contextualiser (GraphRAG)
export { ContextualiserModule } from "./contextualiser/contextualiser.module";
export { ContextualiserService } from "./contextualiser/services/contextualiser.service";
export { ContextualiserContextFactoryService } from "./contextualiser/factories/contextualiser.context.factory";
export { ContextualiserResponseInterface } from "./contextualiser/interfaces/contextualiser.response.interface";

// Graph Creator
export { GraphCreatorModule } from "./graph.creator/graph.creator.module";
export { GraphCreatorService } from "./graph.creator/services/graph.creator.service";
export { ChunkAnalysisInterface } from "./graph.creator/interfaces/chunk.analysis.interface";

// Responder
export { ResponderModule } from "./responder/responder.module";
export { ResponderService } from "./responder/services/responder.service";
export { ResponderResponseInterface } from "./responder/interfaces/responder.response.interface";

// Summariser
export { SummariserModule } from "./summariser/summariser.module";
export { SummariserService } from "./summariser/services/summariser.service";

// Graph (was Chatbot — renamed in Task 2.1; symbols rewired in Phases 5-8)
export { GraphModule } from "./graph/graph.module";
export { GraphSearchService } from "./graph/services/graph.search.service";
export type { MatchMode, RunSearchParams } from "./graph/services/graph.search.service";
export {
  GRAPH_EXACT_MAX_RESULTS,
  GRAPH_FUZZY_MAX_RESULTS,
  GRAPH_SEMANTIC_MAX_RESULTS,
  GRAPH_SEMANTIC_MIN_SCORE,
} from "./graph/services/graph.search.service";
export { GraphDescriptorRegistry } from "./graph/services/descriptor.source";
export { UserModulesRepository } from "./graph/repositories/user-modules.repository";

// Operator
export { OperatorModule } from "./operator/operator.module";
export { operatorMeta } from "./operator/entities/operator.meta";
export { OperatorController } from "./operator/controllers/operator.controller";
export { OperatorService } from "./operator/services/operator.service";
export type { OperatorRunResult } from "./operator/services/operator.service";
export { OperatorContext } from "./operator/contexts/operator.context";
export type { OperatorCitation, OperatorContextState, OperatorFinalAnswer } from "./operator/contexts/operator.context";
export { defaultOperatorSystemPrompt } from "./operator/prompts/operator.system.prompt";
export {
  OperatorCheckpointerService,
  OPERATOR_DEFAULT_APPROVAL_TTL_DAYS,
} from "./operator/services/operator.checkpointer.service";

// Operator (tool layer)
export { OPERATOR_TOOLS } from "./operator/interfaces/operator.tool.interface";
export type {
  OperatorChunkCitation,
  OperatorRetrievalContext,
  OperatorToolCallRecord,
  OperatorToolContribution,
  OperatorToolDefinition,
} from "./operator/interfaces/operator.tool.interface";
export { SearchDocumentsTool } from "./operator/tools/search-documents.tool";
export { SearchCommunitiesTool } from "./operator/tools/search-communities.tool";
export { OperatorTestActionTool } from "./operator/tools/operator-test-action.tool";
export { OperatorToolRegistry } from "./operator/tools/operator.tool.registry";
