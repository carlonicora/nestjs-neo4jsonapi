import { Inject, Injectable, Optional } from "@nestjs/common";
import { baseConfig } from "../../../config/base.config";
import { DescribeEntityTool } from "../../graph/tools/describe-entity.tool";
import { ReadEntityTool } from "../../graph/tools/read-entity.tool";
import { ResolveEntityTool } from "../../graph/tools/resolve-entity.tool";
import { SearchEntitiesTool } from "../../graph/tools/search-entities.tool";
import { ToolCallRecord, UserContext } from "../../graph/tools/tool.factory";
import { TraverseTool } from "../../graph/tools/traverse.tool";
import {
  OPERATOR_TOOLS,
  OperatorRetrievalContext,
  OperatorToolContribution,
  OperatorToolDefinition,
} from "../interfaces/operator.tool.interface";
import { EntityWriteTools } from "./entity-write.tools";
import { OperatorTestActionTool } from "./operator-test-action.tool";
import { SearchCommunitiesTool } from "./search-communities.tool";
import { SearchDocumentsTool } from "./search-documents.tool";

/**
 * Composes the operator's tool set for a single turn:
 * - the five graph tools (read-only, built per request with ctx + recorder)
 * - the two retrieval tools (search_documents, search_communities)
 * - the generic entity write tools, but only when a catalogued type the caller
 *   can reach declares `chat.writable` — otherwise none are built
 * - the test-only destructive tool (non-production environments only)
 * - any app-contributed factories registered under the OPERATOR_TOOLS token,
 *   built per turn with the same ctx + recorder as the built-ins
 */
@Injectable()
export class OperatorToolRegistry {
  constructor(
    private readonly resolveEntityTool: ResolveEntityTool,
    private readonly describeEntityTool: DescribeEntityTool,
    private readonly searchEntitiesTool: SearchEntitiesTool,
    private readonly readEntityTool: ReadEntityTool,
    private readonly traverseTool: TraverseTool,
    private readonly searchDocumentsTool: SearchDocumentsTool,
    private readonly searchCommunitiesTool: SearchCommunitiesTool,
    private readonly operatorTestActionTool: OperatorTestActionTool,
    @Optional() @Inject(OPERATOR_TOOLS) private readonly contributed?: OperatorToolContribution[],
    // Declared last, and optional in the type signature only, so the registry
    // stays constructible without the write-tool provider. Nest resolves it from
    // OperatorModule like every other built-in.
    private readonly entityWriteTools?: EntityWriteTools,
  ) {}

  build(ctx: OperatorRetrievalContext, recorder: ToolCallRecord[]): OperatorToolDefinition[] {
    const userCtx: UserContext = {
      companyId: ctx.companyId,
      userId: ctx.userId,
      userModuleIds: ctx.userModuleIds,
      // Carry the run's scope through to the graph tools, which is the only way
      // their ScopeGuard checks can see which root this turn is confined to.
      scopeId: ctx.scopeId,
      scopeType: ctx.scopeType,
    };

    const definitions: OperatorToolDefinition[] = [
      { tool: this.resolveEntityTool.build(userCtx, recorder), destructive: false },
      { tool: this.describeEntityTool.build(userCtx, recorder), destructive: false },
      { tool: this.searchEntitiesTool.build(userCtx, recorder), destructive: false },
      { tool: this.readEntityTool.build(userCtx, recorder), destructive: false },
      { tool: this.traverseTool.build(userCtx, recorder), destructive: false },
      { tool: this.searchDocumentsTool.build(ctx, recorder), destructive: false },
      // ctx carries the turn's cost attribution down into the DRIFT sub-agent.
      { tool: this.searchCommunitiesTool.build(recorder, ctx), destructive: false },
    ];

    // Generic write tools. buildDefinitions() returns [] unless a catalogued
    // type the caller can reach is chat.writable, so hosts that opt none in keep
    // exactly the read-only tool set they had before. Spliced in before the
    // contributed spread so the duplicate-name guard below covers them too.
    definitions.push(...(this.entityWriteTools?.buildDefinitions(ctx, recorder) ?? []));

    if (baseConfig.environment.nodeEnv !== "production") {
      definitions.push(this.operatorTestActionTool.buildDefinition(recorder));
    }

    // Contributions are factories: build them per turn so they receive the
    // request context (company scoping) and the shared tool-call recorder.
    const all = [...definitions, ...(this.contributed ?? []).map((contribution) => contribution.build(ctx, recorder))];

    // Guard against name collisions: a contributed tool named like a built-in
    // would silently shadow it in the service's toolMap while both get bound to the model.
    const seen = new Set<string>();
    for (const definition of all) {
      const name = definition.tool.name;
      if (seen.has(name)) {
        throw new Error(
          `OperatorToolRegistry: duplicate tool name "${name}". ` +
            `A contributed OPERATOR_TOOLS contribution must not reuse the name of a built-in or another contributed tool.`,
        );
      }
      seen.add(name);
    }

    return all;
  }
}
