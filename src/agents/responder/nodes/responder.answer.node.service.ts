import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { LLMService } from "../../../core/llm/services/llm.service";
import { ResponderContext, ResponderContextState } from "../../responder/contexts/responder.context";
import type { EntityReference } from "../interfaces/entity.reference.interface";

export const defaultAnswerPrompt = `
You are the synthesizer of a unified ERP assistant. You are given a user
question and the results of up to three retrieval branches that ran in
parallel before you. Your job is to write a clear, useful answer using
ONLY the data those branches returned.

## What you receive

Each turn arrives with these inputs:

- \`question\` — the user's refined question.
- \`graphSection\` — the graph branch's own prose reply about the records it
  loaded, followed by an "--- entities for citation ---" block listing each
  cited entity as \`[ref:N] type — reason\` plus an optional JSON block of
  field values. Treat the prose at the top of \`graphSection\` as the
  authoritative graph result; weave it into the unified answer rather than
  restating the entity list line-by-line. The \`[ref:N]\` handles are opaque
  reference tokens — use them only inside the \`references\` array, never
  inside \`finalAnswer\` or \`title\`.
- \`notebookSection\` — chunks the contextualiser branch retrieved from the
  document store, each prefixed with its chunkId followed by a snippet of
  text.
- \`driftSection\` — community-level summaries (when the drift branch ran).
- \`scopeSection\` — optional scope hint when the conversation is bound to a
  single content.
- \`branchesUsed\` — list of branches that produced data this turn.

A section is the empty string \`""\` when its branch did not run. When all
data sections are empty, you have no information for this turn — say so
plainly without referencing "company knowledge", "notebook", or other
system internals.

## How to write the answer

1. **Identify the user's intent.** Are they asking for a list, a single
   fact, a procedure, a status, or a comparison? Match the answer's shape
   to the question.

2. **Use the graph branch's prose as authoritative graph data.** The
   prose at the top of \`graphSection\` was written by the same component
   that loaded the records; it already contains the field values, names,
   and statuses. Weave it into \`finalAnswer\`. You may reorganise it,
   merge it with material from \`notebookSection\` or \`driftSection\`, or
   tighten the wording — but do not invent values that are not in the
   prose, the entity field blocks, or the chunks.

3. **Quote chunk content faithfully.** When you draw from
   \`notebookSection\`, quote or paraphrase the snippet rather than
   substituting your own restatement.

4. **Cite the chunks that grounded a document answer.** When you quote or
   paraphrase from \`notebookSection\`, add the chunkId to \`citations\` with
   a relevance score 0–100. Use only chunkIds that actually appear in
   \`notebookSection\`. If \`notebookSection\` is empty, \`citations\` MUST be
   \`[]\`.

5. **Cite the entities that grounded a graph answer.** Every entity whose
   information the answer relies on goes into \`references\` as
   \`{ ref, relevance, reason }\`, with the \`ref\` handle copied verbatim
   from the "entities for citation" block (e.g. \`"ref:0"\`). Never invent
   a handle. Never put a chunk into \`references\`; never put an entity
   into \`citations\`. If \`graphSection\` is empty, \`references\` MUST be
   \`[]\`.

6. **No handles, no UUIDs in user-facing text.** \`title\` and
   \`finalAnswer\` must not contain the word "ref", the bracketed handle,
   or any UUID. The handles are translated back to real (type, id) pairs
   after you return.

7. **Suggested questions are optional.** If the answer is solid and
   obvious next-step questions exist, propose 3–5; otherwise return \`[]\`.
   Do not return suggestions when you had no data.

8. **No-data case.** If every data section is empty (or together they do
   not cover what the user asked), say so directly. Do not say "answer
   is not available in the company knowledge" — that is a bad system
   phrase. Return \`citations: []\` and \`references: []\` in this case.

## Output schema

Return strictly:

- \`title\` — short headline for the UI (under ~70 chars). No handles, no UUIDs.
- \`analyse\` — one to three sentences describing how you derived the answer
  (which branches you used, which records you compared). Internal-facing.
  No handles.
- \`finalAnswer\` — the user-facing markdown answer. Use headings sparingly,
  bullet lists where they help, and field values from the graph branch's
  prose and entity field blocks. No handles, no UUIDs.
- \`citations\` — array of \`{ chunkId, relevance }\` for chunks you used.
- \`references\` — array of \`{ ref, relevance, reason }\` for entities you used.
- \`questions\` — array of follow-up question strings.
`;

const outputSchema = z.object({
  title: z.string().describe(`You should generate a short title to provide the user a quick reference`),
  analyse: z
    .string()
    .describe(
      `You should first analyse each notebook content before providing a final answer. During the analysis, consider complementary information from other notes and employ a majority voting strategy to resolve any inconsistencies.`,
    ),
  citations: z
    .array(
      z.object({
        chunkId: z.string().describe(`The UUID of the line in your notebook`),
        relevance: z
          .number()
          .describe(
            `The relevance of the information in the line of your notebook in percentage between 0 and 100. This defines if the information is relevant to the question or not and if it will be used as a citation.`,
          ),
      }),
    )
    .describe(
      `You should provide citations to the information you used to generate the final answer. Consider ALL the ChunkIds in your notebook. Each citation should have a relevance score. Each ChunkId should be unique. Each ChunkId should have a relevance score.`,
    ),
  references: z
    .array(
      z.object({
        ref: z
          .string()
          .describe('A `[ref:N]` handle copied verbatim from the "entities for citation" block of `graphSection`'),
        relevance: z.number().describe("Relevance of this entity to the final answer (0-100)"),
        reason: z.string().describe("A short justification for why the entity grounds the answer"),
      }),
    )
    .describe(
      `The graph entities the answer is grounded on. Use ONLY \`ref\` handles that appear in the "entities for citation" block of \`graphSection\`, copied verbatim (e.g. "ref:0"). Never invent ref handles. If the graph branch did not run or no entities were used, return an empty array.`,
    ),
  questions: z
    .array(z.string())
    .describe(`A list of **5 follow-up or refinement questions** based on the final answer.`),
  finalAnswer: z.string().describe(
    `Generate a comprehensive, detailed, and well-structured final answer using only information from the notebook. If insufficient information is available, clearly state that the answer is not available in the company knowledge.

Format Requirements:
- Use proper markdown formatting with headers (##, ###) to organize content into logical sections
- Include bullet points or numbered lists for multiple items, steps, or concepts
- Expand on concepts with thorough explanations rather than brief summaries
- Use subheadings to break complex topics into digestible parts
- Provide detailed context and background information to help users understand completely
- Include specific examples or details from the notebook when available
- Ensure the answer flows logically and is educational in nature
- Make the response comprehensive and informative, not minimalistic
      `,
  ),
});

const inputSchema = z.object({
  question: z.string().describe("The user's refined question"),
  notebookSection: z
    .string()
    .describe("Notebook from the contextualiser branch (chunkId-prefixed lines), or empty if that branch did not run"),
  graphSection: z.string().describe("Graph entities discovered for the question, or empty if that branch did not run"),
  driftSection: z.string().describe("Community-level summaries from drift, or empty if that branch did not run"),
  scopeSection: z.string().describe("Optional content-scope hint, or empty"),
  branchesUsed: z.array(z.string()).describe("Names of branches whose data is included"),
});

type ContextField = NonNullable<(typeof ResponderContext.State)["context"]>;
type DriftContextField = NonNullable<(typeof ResponderContext.State)["driftContext"]>;

@Injectable()
export class ResponderAnswerNodeService {
  private readonly logger = new Logger(ResponderAnswerNodeService.name);
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.responder ?? defaultAnswerPrompt;
  }

  async execute(params: { state: typeof ResponderContext.State }): Promise<ResponderContextState> {
    const state = params.state;
    const branchPlan = state.branchPlan ?? {
      runGraph: false,
      runContextualiser: false,
      runDrift: false,
      reasoning: "",
    };

    const branchesUsed: ("graph" | "contextualiser" | "drift")[] = [];
    if (branchPlan.runGraph) branchesUsed.push("graph");
    if (branchPlan.runContextualiser) branchesUsed.push("contextualiser");
    if (branchPlan.runDrift) branchesUsed.push("drift");

    // Build a ref-handle map so the synthesizer never sees raw UUIDs.
    const refMap = (state.graphContext?.entities ?? []).map((e, i) => ({
      ref: `ref:${i}`,
      type: e.type,
      id: e.id,
      reason: e.reason,
      fields: e.fields,
    }));

    const notebookSection =
      branchPlan.runContextualiser && state.context ? this.buildNotebookSection(state.context) : "";
    const graphAnswer = state.graphContext?.answer ?? "";
    const graphSection = branchPlan.runGraph && state.graphContext ? this.buildGraphSection(graphAnswer, refMap) : "";
    const driftSection = branchPlan.runDrift && state.driftContext ? this.buildDriftSection(state.driftContext) : "";
    const scopeSection =
      state.contentId && state.contentType
        ? `\n\n--- CONVERSATION SCOPE ---\nThe conversation is scoped to ${state.contentType}:${state.contentId}.`
        : "";

    this.logger.log(
      `answer node input: branchesUsed=${JSON.stringify(branchesUsed)} ` +
        `graphEntities=${state.graphContext?.entities?.length ?? 0} ` +
        `graphAnswerChars=${graphAnswer.length} ` +
        `notebookChars=${notebookSection.length} ` +
        `graphChars=${graphSection.length} ` +
        `driftChars=${driftSection.length} ` +
        `scopeChars=${scopeSection.length}`,
    );
    if (graphSection.length) this.logger.debug(`answer node graphSection:\n${graphSection}`);

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema,
      inputParams: {
        question: state.question ?? "",
        notebookSection,
        graphSection,
        driftSection,
        scopeSection,
        branchesUsed,
      },
      outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.1,
      metadata: {
        nodeName: "answer",
        agentName: "responder",
        userQuestion: state.question,
      },
    });

    // Sources — chunks from the contextualiser branch
    const sources = (llmResponse.citations ?? []).map((c) => ({
      chunkId: c.chunkId ?? "",
      relevance: c.relevance ?? 0,
      reason: "",
    }));
    if (state.context) {
      for (const s of sources) {
        const note = state.context.notebook?.find((n) => n.chunkId === s.chunkId);
        if (note) s.reason = note.reason;
      }
    }
    const filteredSources = this.deduplicateByChunkId(sources);

    // References — remap [ref:N] handles back to (type, id). Drop any handle the
    // synthesizer invented that doesn't appear in the graph node's output.
    const byRef = new Map(refMap.map((e) => [e.ref, e]));
    const references: EntityReference[] = (llmResponse.references ?? [])
      .map((r) => {
        const hit = byRef.get(r.ref);
        if (!hit) return null;
        return {
          type: hit.type,
          id: hit.id,
          relevance: Math.max(0, Math.min(100, r.relevance ?? 0)),
          reason: r.reason ?? "",
        };
      })
      .filter((x): x is EntityReference => x !== null);

    const llmRefCount = (llmResponse.references ?? []).length;
    const droppedRefs = llmRefCount - references.length;
    this.logger.log(
      `answer node done: title=${JSON.stringify(llmResponse.title)} ` +
        `finalAnswerChars=${(llmResponse.finalAnswer ?? "").length} ` +
        `citations=${filteredSources.length} ` +
        `references=${references.length}${droppedRefs > 0 ? ` (${droppedRefs} hallucinated dropped)` : ""} ` +
        `tokens=${JSON.stringify(llmResponse.tokenUsage ?? { input: 0, output: 0 })}`,
    );
    if (llmRefCount === 0 && (state.graphContext?.entities?.length ?? 0) > 0) {
      this.logger.warn(
        `answer node returned 0 references despite ${state.graphContext?.entities?.length} graph entities being available — synthesizer prompt likely needs reinforcement`,
      );
    }

    state.sources = filteredSources;
    state.references = references;
    state.ontologies = state.context?.ontology ?? [];

    state.tokens = {
      input: (state.tokens?.input || 0) + (llmResponse.tokenUsage?.input || 0),
      output: (state.tokens?.output || 0) + (llmResponse.tokenUsage?.output || 0),
    };

    state.finalAnswer = {
      title: llmResponse.title,
      analysis: llmResponse.analyse,
      answer: llmResponse.finalAnswer,
      questions: llmResponse.questions ?? [],
      hasAnswer: branchesUsed.length > 0 || filteredSources.length + references.length > 0,
    };

    state.trace = {
      ...state.trace,
      answer: { branchesUsed, tokens: llmResponse.tokenUsage ?? { input: 0, output: 0 } },
      totalTokens: state.tokens,
    } as any;

    return state;
  }

  private buildNotebookSection(ctx: ContextField): string {
    const lines: string[] = ["", "--- NOTEBOOK (chunks discovered) ---"];
    if (ctx.annotations) lines.push(ctx.annotations);
    for (const n of ctx.notebook ?? []) lines.push(`${n.chunkId}: ${n.content}`);
    return lines.join("\n");
  }

  private buildGraphSection(
    graphAnswer: string,
    refMap: Array<{ ref: string; type: string; reason: string; fields?: Record<string, unknown> }>,
  ): string {
    const lines: string[] = ["", "--- GRAPH BRANCH ---"];
    if (graphAnswer.trim().length > 0) {
      lines.push("", graphAnswer.trim());
    }
    lines.push("", "--- entities for citation ---");
    for (const e of refMap) {
      lines.push(`[${e.ref}] ${e.type} — ${e.reason}`);
      if (e.fields && Object.keys(e.fields).length > 0) {
        lines.push(JSON.stringify(e.fields, null, 2));
      }
    }
    return lines.join("\n");
  }

  private buildDriftSection(d: DriftContextField): string {
    const parts: string[] = ["", "--- DRIFT (community-level summaries) ---"];
    if (d.matchedCommunities?.length) {
      for (const c of d.matchedCommunities) {
        parts.push(`### ${c.name ?? "Community"}`);
        if (c.summary) parts.push(c.summary);
      }
    }
    if (d.initialAnswer) parts.push(`Initial analysis: ${d.initialAnswer}`);
    if (d.followUpAnswers?.length) {
      for (const f of d.followUpAnswers) parts.push(`${f.question} → ${f.answer}`);
    }
    if (d.confidence !== undefined) parts.push(`Drift confidence: ${d.confidence}%`);
    return parts.join("\n");
  }

  private deduplicateByChunkId(
    sources: { chunkId: string; relevance: number; reason: string }[],
  ): { chunkId: string; relevance: number; reason: string }[] {
    const out: { chunkId: string; relevance: number; reason: string }[] = [];
    for (const s of sources) {
      const existing = out.find((o) => o.chunkId === s.chunkId);
      if (!existing) {
        out.push(s);
        continue;
      }
      if (s.relevance > existing.relevance) existing.relevance = s.relevance;
    }
    return out;
  }
}
