// packages/nestjs-neo4jsonapi/src/agents/graph/graph.module.ts
import { Global, Module } from "@nestjs/common";
import { SCOPE_PREDICATE_SOURCE } from "../../common/repositories/scope-predicate.source";
import { BlockNoteModule } from "../../core/blocknote/blocknote.module";
import { LLMModule } from "../../core/llm/llm.module";
import { UserModulesRepository } from "./repositories/user-modules.repository";
import { GraphIndexManager } from "./services/graph.index.manager";
import { GraphSearchService } from "./services/graph.search.service";
import { GraphDescriptorRegistry } from "./services/descriptor.source";
import { GraphCatalogService } from "./services/graph.catalog.service";
import { ToolFieldFormatterService } from "./services/field-formatting";
import { RelatedEdgesService } from "./services/related-edges.service";
import { ScopeGuard } from "./services/scope.guard";
import { ScopePredicateService } from "./services/scope.predicate.service";
import { DescribeEntityTool } from "./tools/describe-entity.tool";
import { ReadEntityTool } from "./tools/read-entity.tool";
import { ResolveEntityTool } from "./tools/resolve-entity.tool";
import { SearchEntitiesTool } from "./tools/search-entities.tool";
import { ToolFactory } from "./tools/tool.factory";
import { TraverseTool } from "./tools/traverse.tool";

/**
 * `@Global()` so the CORE layer can resolve `SCOPE_PREDICATE_SOURCE` without
 * importing this module. Core-layer retrieval must be able to ask "is this node
 * in the run's scope root?", but the answer is compiled from the catalog, which
 * lives here — above core. A global token is the seam that keeps the dependency
 * pointing one way. Consumers that never load GraphModule simply have no scope
 * roots, and retrieval stays company-scoped exactly as before.
 */
@Global()
@Module({
  imports: [LLMModule, BlockNoteModule],
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
    ScopeGuard,
    ScopePredicateService,
    ToolFieldFormatterService,
    RelatedEdgesService,
    { provide: SCOPE_PREDICATE_SOURCE, useExisting: ScopePredicateService },
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
    ScopeGuard,
    ScopePredicateService,
    ToolFieldFormatterService,
    RelatedEdgesService,
    SCOPE_PREDICATE_SOURCE,
  ],
})
export class GraphModule {}
