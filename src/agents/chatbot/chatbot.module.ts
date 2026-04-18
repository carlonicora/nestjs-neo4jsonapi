import { Module } from "@nestjs/common";
import { LLMModule } from "../../core/llm/llm.module";
import { UserModulesRepository } from "./repositories/user-modules.repository";
import { ChatbotIndexManager } from "./services/chatbot.index.manager";
import { ChatbotService } from "./services/chatbot.service";
import { GraphDescriptorRegistry } from "./services/descriptor.source";
import { GraphCatalogService } from "./services/graph.catalog.service";
import { DescribeEntityTool } from "./tools/describe-entity.tool";
import { ReadEntityTool } from "./tools/read-entity.tool";
import { SearchEntitiesTool } from "./tools/search-entities.tool";
import { ToolFactory } from "./tools/tool.factory";
import { TraverseTool } from "./tools/traverse.tool";

@Module({
  imports: [LLMModule],
  providers: [
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

    // Per-label fulltext + vector index manager (fires once on module init)
    ChatbotIndexManager,
  ],
  exports: [
    ChatbotService,
    GraphDescriptorRegistry,
    GraphCatalogService,
    UserModulesRepository,
    ToolFactory,
    DescribeEntityTool,
    SearchEntitiesTool,
    ReadEntityTool,
    TraverseTool,
  ],
})
export class ChatbotModule {}
