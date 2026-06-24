import { Inject, Injectable, Optional } from "@nestjs/common";
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
import { OperatorTestActionTool } from "./operator-test-action.tool";
import { SearchCommunitiesTool } from "./search-communities.tool";
import { SearchDocumentsTool } from "./search-documents.tool";

/**
 * Composes the operator's tool set for a single turn:
 * - the five graph tools (read-only, built per request with ctx + recorder)
 * - the two retrieval tools (search_documents, search_communities)
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
  ) {}

  build(ctx: OperatorRetrievalContext, recorder: ToolCallRecord[]): OperatorToolDefinition[] {
    const userCtx: UserContext = {
      companyId: ctx.companyId,
      userId: ctx.userId,
      userModuleIds: ctx.userModuleIds,
    };

    const definitions: OperatorToolDefinition[] = [
      { tool: this.resolveEntityTool.build(userCtx, recorder), destructive: false },
      { tool: this.describeEntityTool.build(userCtx, recorder), destructive: false },
      { tool: this.searchEntitiesTool.build(userCtx, recorder), destructive: false },
      { tool: this.readEntityTool.build(userCtx, recorder), destructive: false },
      { tool: this.traverseTool.build(userCtx, recorder), destructive: false },
      { tool: this.searchDocumentsTool.build(ctx, recorder), destructive: false },
      { tool: this.searchCommunitiesTool.build(recorder), destructive: false },
    ];

    if (process.env.NODE_ENV !== "production") {
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
