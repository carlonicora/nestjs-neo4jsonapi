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

// Chatbot
export { ChatbotModule } from "./chatbot/chatbot.module";
export { ChatbotService } from "./chatbot/services/chatbot.service";
export { ChatbotSearchService } from "./chatbot/services/chatbot.search.service";
export type {
  MatchMode,
  SearchItem,
  SearchResult,
  RunSearchParams,
} from "./chatbot/services/chatbot.search.service";
export {
  CHATBOT_EXACT_MAX_RESULTS,
  CHATBOT_FUZZY_MAX_RESULTS,
  CHATBOT_SEMANTIC_MAX_RESULTS,
  CHATBOT_SEMANTIC_MIN_SCORE,
} from "./chatbot/services/chatbot.search.service";
export { GraphDescriptorRegistry } from "./chatbot/services/descriptor.source";
export type {
  ChatbotResponseInterface,
  ChatbotReference,
  ChatbotToolCall,
} from "./chatbot/interfaces/chatbot.response.interface";
export type { ChatbotRunParams } from "./chatbot/services/chatbot.service";
export { UserModulesRepository } from "./chatbot/repositories/user-modules.repository";
