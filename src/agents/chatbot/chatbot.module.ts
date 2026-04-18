import { Module } from "@nestjs/common";
import { LLMModule } from "../../core/llm/llm.module";
import { GraphCatalogService } from "./services/graph.catalog.service";
import { GraphDescriptorRegistry } from "./services/descriptor.source";
import { ChatbotService } from "./services/chatbot.service";
import { ToolFactory } from "./tools/tool.factory";
import { DescribeEntityTool } from "./tools/describe-entity.tool";
import { SearchEntitiesTool } from "./tools/search-entities.tool";
import { ReadEntityTool } from "./tools/read-entity.tool";
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
    ChatbotService,
  ],
  exports: [ChatbotService, GraphDescriptorRegistry],
})
export class ChatbotModule {}
