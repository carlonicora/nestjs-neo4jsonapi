import { Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { LLMModule } from "../../core/llm/llm.module";
import { AssistantController } from "./controllers/assistant.controller";
import { ConversationDescriptor } from "./entities/conversation";
import { ConversationRepository } from "./repositories/conversation.repository";
import { UserModulesRepository } from "./repositories/user-modules.repository";
import { ChatbotIndexManager } from "./services/chatbot.index.manager";
import { ChatbotService } from "./services/chatbot.service";
import { ConversationService } from "./services/conversation.service";
import { GraphDescriptorRegistry } from "./services/descriptor.source";
import { GraphCatalogService } from "./services/graph.catalog.service";
import { NameEmbeddingService } from "./services/name.embedding.service";
import { DescribeEntityTool } from "./tools/describe-entity.tool";
import { ReadEntityTool } from "./tools/read-entity.tool";
import { SearchEntitiesTool } from "./tools/search-entities.tool";
import { ToolFactory } from "./tools/tool.factory";
import { TraverseTool } from "./tools/traverse.tool";

@Module({
  imports: [LLMModule],
  controllers: [AssistantController],
  providers: [
    // Serialiser from descriptor (Conversation now owns the "assistants" JSON:API type)
    ConversationDescriptor.model.serialiser,

    GraphDescriptorRegistry,
    {
      provide: GraphCatalogService,
      useFactory: (src: GraphDescriptorRegistry) => new GraphCatalogService(src),
      inject: [GraphDescriptorRegistry],
    },
    ToolFactory,
    DescribeEntityTool,
    SearchEntitiesTool,
    ReadEntityTool,
    TraverseTool,
    UserModulesRepository,
    ChatbotService,

    // Persistent conversation storage + lifecycle
    ConversationRepository,
    ConversationService,

    // Name-embedding helper for chat-enabled entity services (called explicitly in their create/put/patch)
    NameEmbeddingService,

    // Per-label fulltext + vector index manager (fires once on module init)
    ChatbotIndexManager,
  ],
  exports: [ChatbotService, GraphDescriptorRegistry, ConversationService, ConversationRepository, NameEmbeddingService],
})
export class ChatbotModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(ConversationDescriptor.model);
  }
}
