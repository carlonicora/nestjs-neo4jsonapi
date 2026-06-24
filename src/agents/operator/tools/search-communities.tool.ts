import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DriftSearchService } from "../../drift/services/drift.search.service";
import { ToolCallRecord, ToolFactory } from "../../graph/tools/tool.factory";

const inputSchema = z.object({
  question: z.string().describe("The natural-language question to answer from the company's knowledge communities."),
});

// Mirrors search_documents' NO_INFORMATION_MESSAGE: models handle an explicit
// "no information" ToolMessage far better than an empty string.
const NO_INFORMATION_MESSAGE = "No information found in the company's knowledge communities for this question.";

@Injectable()
export class SearchCommunitiesTool {
  constructor(
    private readonly factory: ToolFactory,
    private readonly driftSearchService: DriftSearchService,
  ) {}

  build(recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "search_communities",
      description:
        "Search the company's knowledge communities (DRIFT search) for a thematic, high-level answer to a question.",
      schema: inputSchema,
      func: async (input) => this.invoke(input, recorder),
    });
  }

  async invoke(input: z.infer<typeof inputSchema>, recorder: ToolCallRecord[]): Promise<string> {
    return this.factory.capture(
      { tool: "search_communities", input },
      async () => {
        // Same invocation as the responder's drift branch (responder.service.ts).
        const result = await this.driftSearchService.search({ question: input.question });
        return result.answer || NO_INFORMATION_MESSAGE;
      },
      recorder,
    );
  }
}
