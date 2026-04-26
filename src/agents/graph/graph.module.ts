// packages/nestjs-neo4jsonapi/src/agents/graph/graph.module.ts
import { Module } from "@nestjs/common";
import { LLMModule } from "../../core/llm/llm.module";
import { UserModulesRepository } from "./repositories/user-modules.repository";
import { GraphIndexManager } from "./services/graph.index.manager";
import { GraphSearchService } from "./services/graph.search.service";
import { GraphDescriptorRegistry } from "./services/descriptor.source";
import { GraphCatalogService } from "./services/graph.catalog.service";
import { DescribeEntityTool } from "./tools/describe-entity.tool";
import { ReadEntityTool } from "./tools/read-entity.tool";
import { ResolveEntityTool } from "./tools/resolve-entity.tool";
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
    ResolveEntityTool,
    DescribeEntityTool,
    SearchEntitiesTool,
    ReadEntityTool,
    TraverseTool,
    UserModulesRepository,
    GraphIndexManager,
    GraphSearchService,
  ],
  exports: [
    GraphDescriptorRegistry,
    GraphCatalogService,
    UserModulesRepository,
    ToolFactory,
    ResolveEntityTool,
    DescribeEntityTool,
    SearchEntitiesTool,
    ReadEntityTool,
    TraverseTool,
    GraphSearchService,
  ],
})
export class GraphModule {}
