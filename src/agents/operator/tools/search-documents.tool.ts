import { DynamicStructuredTool } from "@langchain/core/tools";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { TokenUsageType } from "../../../foundations/tokenusage/enums/tokenusage.type";
import { buildCallerAttribution } from "../../common/usage-attribution";
import { ContextualiserService } from "../../contextualiser/services/contextualiser.service";
import { ScopeGuard } from "../../graph/services/scope.guard";
import { ToolCallRecord, ToolFactory } from "../../graph/tools/tool.factory";
import { OperatorRetrievalContext, OperatorToolCallRecord } from "../interfaces/operator.tool.interface";

const inputSchema = z.object({
  question: z.string().describe("The natural-language question to answer from the company's documents."),
});

export { inputSchema as searchDocumentsInputSchema };

const NO_INFORMATION_MESSAGE = "No information found in the company documents for this question.";

@Injectable()
export class SearchDocumentsTool {
  constructor(
    private readonly factory: ToolFactory,
    private readonly contextualiserService: ContextualiserService,
    // ScopeGuard is deliberately the LAST constructor parameter so existing
    // positional call sites keep working.
    private readonly scopeGuard: ScopeGuard,
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
            // The contextualiser is a sub-agent: this spend is the OPERATOR's,
            // billed to the operator's category against the turn's entity.
            attribution: buildCallerAttribution({ tokenUsageType: TokenUsageType.Operator, source: ctx }),
          });

          const notebook = await this.dropOutOfScope(state.notebook ?? [], ctx);
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

  /**
   * Enforcement point: a scoped run must not read passages whose source record
   * lives under another scope root.
   *
   * Retrieved passages carry their provenance in the opaque `metadata` bag the
   * contributing retrieval source filled in. Entries that name a source record
   * are grouped by type and checked with ONE ScopeGuard.filter call per type
   * (never one per chunk). Entries that name no source record are plain
   * document chunks with no entity provenance to test — they are company-wide
   * material (help content and the like) and are left alone; scoping them is
   * only possible once a retrieval source tags them.
   */
  private async dropOutOfScope<T extends { metadata?: Record<string, unknown> }>(
    entries: T[],
    ctx: OperatorRetrievalContext,
  ): Promise<T[]> {
    if (!ctx.scopeId || !ctx.scopeType) return entries;
    if (entries.length === 0) return entries;

    const sourceOf = (entry: T): { type: string; id: string } | undefined => {
      const metadata = entry.metadata ?? {};
      const type = metadata.entityType ?? metadata.sourceType ?? metadata.type;
      const id = metadata.entityId ?? metadata.sourceId ?? metadata.id;
      return typeof type === "string" && type && typeof id === "string" && id ? { type, id } : undefined;
    };

    const byType = new Map<string, Set<string>>();
    for (const entry of entries) {
      const source = sourceOf(entry);
      if (!source) continue;
      const ids = byType.get(source.type) ?? new Set<string>();
      ids.add(source.id);
      byType.set(source.type, ids);
    }
    if (byType.size === 0) return entries;

    const allowed = new Map<string, Set<string>>();
    for (const [type, ids] of byType) {
      const kept = await this.scopeGuard.filter({
        type,
        records: Array.from(ids).map((id) => ({ id })),
        ctx,
      });
      allowed.set(type, new Set(kept.map((record) => record.id)));
    }

    return entries.filter((entry) => {
      const source = sourceOf(entry);
      if (!source) return true;
      return allowed.get(source.type)?.has(source.id) ?? false;
    });
  }
}
