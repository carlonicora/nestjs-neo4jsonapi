import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ContextualiserService } from "../../contextualiser/services/contextualiser.service";
import { ToolCallRecord, ToolFactory } from "../../graph/tools/tool.factory";
import { OperatorRetrievalContext, OperatorToolCallRecord } from "../interfaces/operator.tool.interface";

const inputSchema = z.object({
  question: z.string().describe("The natural-language question to answer from the company's documents."),
});

const NO_INFORMATION_MESSAGE = "No information found in the company documents for this question.";

@Injectable()
export class SearchDocumentsTool {
  constructor(
    private readonly factory: ToolFactory,
    private readonly contextualiserService: ContextualiserService,
  ) {}

  build(ctx: OperatorRetrievalContext, recorder: ToolCallRecord[]): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: "search_documents",
      description:
        "Search the company's documents (GraphRAG) for information relevant to a question. Returns the retrieved passages, each prefixed by its chunkId.",
      schema: inputSchema,
      func: async (input) => this.invoke(input, ctx, recorder),
    });
  }

  async invoke(
    input: z.infer<typeof inputSchema>,
    ctx: OperatorRetrievalContext,
    recorder: ToolCallRecord[],
  ): Promise<string> {
    // capture() pushes its record (success or error) into the recorder it is given.
    // Capturing into a local recorder first lets us attach citations to OUR record
    // without racing concurrently-executing tools on the shared recorder.
    const local: OperatorToolCallRecord[] = [];
    try {
      const result = await this.factory.capture(
        { tool: "search_documents", input },
        async () => {
          // Same invocation as the responder's contextualiser branch (responder.service.ts).
          const state = await this.contextualiserService.run({
            companyId: ctx.companyId,
            contentId: ctx.contentId ?? "",
            contentType: ctx.contentType ?? "",
            dataLimits: ctx.dataLimits,
            messages: ctx.messages,
            question: input.question,
          });

          const notebook = state.notebook ?? [];
          return {
            answer: notebook.length
              ? notebook.map((n) => `${n.chunkId}: ${n.content}`).join("\n")
              : NO_INFORMATION_MESSAGE,
            citations: notebook.map((n) => ({ chunkId: n.chunkId, relevance: 100 })),
          };
        },
        local,
      );

      if (result.citations.length && local.length) {
        local[0].citations = result.citations;
      }
      return result.answer;
    } finally {
      // capture() records errors too — always flush the local record into the shared recorder.
      recorder.push(...local);
    }
  }
}
