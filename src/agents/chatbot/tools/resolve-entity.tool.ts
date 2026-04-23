import { Injectable } from "@nestjs/common";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord, UserContext } from "./tool.factory";
import { ChatbotSearchService } from "../services/chatbot.search.service";

const inputSchema = z.object({
  text: z.string().min(1).describe("The user's literal phrase. Pass 'Faby and Carlo' verbatim, not split."),
});

@Injectable()
export class ResolveEntityTool {
  constructor(
    private readonly factory: ToolFactory,
    private readonly search: ChatbotSearchService,
  ) {}

  build(ctx: UserContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "resolve_entity",
      description:
        "Resolve a user-named entity across every visible type. Returns ranked candidates from the highest-confidence tier that yielded any match anywhere. Use this before search_entities / read_entity / traverse whenever the user refers to a named record.",
      schema: inputSchema,
      func: async (input) => JSON.stringify(await this.invoke(input, ctx, recorder)),
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, ctx: UserContext, recorder: ToolCallRecord[]): Promise<unknown> {
    return this.factory.capture(
      { tool: "resolve_entity", input },
      async () =>
        this.search.resolveEntity({
          text: input.text,
          companyId: ctx.companyId,
          userModuleIds: ctx.userModuleIds,
        }),
      recorder,
    );
  }
}
