import { BadRequestException, Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { GraphSearchService } from "../services/graph.search.service";

const inputSchema = z.object({
  text: z.string().min(1).describe("The user's literal phrase. Pass 'Faby and Carlo' verbatim, not split."),
  types: z
    .array(z.string())
    .optional()
    .describe(
      'Catalog type names to search, e.g. ["accounts"]. Omitted: every visible type except personal communication (emails, messages, chats), which the reply lists in excludedTypes.',
    ),
});

export { inputSchema as resolveEntityInputSchema };

@Injectable()
export class ResolveEntityTool {
  constructor(
    private readonly factory: ToolFactory,
    private readonly search: GraphSearchService,
  ) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "resolve_entity",
      description:
        "Resolve a user-named entity across every visible type. Returns ranked candidates from the highest-confidence tier that yielded any match anywhere. Use this before search_entities / read_entity / traverse whenever the user refers to a named record.",
      schema: inputSchema,
      // An unknown `types` entry throws a BadRequestException (validation_failed
      // over MCP); the LangGraph path hands the model the message instead, so
      // it can retry with a visible type rather than abort the turn.
      func: async (input) => {
        try {
          return JSON.stringify(await this.invoke(input, ctx, recorder));
        } catch (e) {
          if (e instanceof BadRequestException) return JSON.stringify({ error: e.message });
          throw e;
        }
      },
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.factory.capture(
      { tool: "resolve_entity", input },
      async () =>
        // scopeId/scopeType are load-bearing: without them GraphSearchService
        // skips its scope predicate entirely and name resolution ranks
        // candidates from every scope root in the company, leaking names and
        // types across campaigns even though read/traverse would refuse them.
        this.search.resolveEntity({
          text: input.text,
          companyId: ctx.companyId,
          userModuleIds: ctx.userModuleIds,
          scopeId: ctx.scopeId,
          scopeType: ctx.scopeType,
          types: input.types,
        }),
      recorder,
    );
  }
}
