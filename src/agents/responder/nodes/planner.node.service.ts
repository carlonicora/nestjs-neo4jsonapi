import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { LLMService } from "../../../core/llm/services/llm.service";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";
import { ResponderContextState } from "../contexts/responder.context";

const PlannerOutputSchema = z.object({
  runGraph: z.boolean(),
  runContextualiser: z.boolean(),
  runDrift: z.boolean(),
  reasoning: z.string(),
  refinedQuestion: z.string(),
});

const PlannerInputSchema = z.object({
  rawQuestion: z.string(),
  catalog: z.string(),
  history: z.array(z.object({ role: z.string(), content: z.string() })),
  contentScope: z.object({ contentType: z.string(), contentId: z.string() }).nullable(),
});

export const PLANNER_SYSTEM_PROMPT = `
You decide which retrieval branches a unified assistant should run for a single user turn.

You have three branches to choose from (subset, not exclusive):
- runGraph        → traverses entities (accounts, orders, etc.) the user has access to via tools
- runContextualiser → multi-hop document retrieval (chunks, atomic facts, key concepts)
- runDrift        → community-level summary search

Decide based on the user's question, prior chat history, the available entity catalog, and any content scope.
You MUST select at least one branch. Prefer multiple branches in parallel when the question could plausibly draw on more than one.

Refine the question into a single canonical form that all chosen branches can use.

When you produce \`refinedQuestion\`, preserve every proper-noun-looking span in the user's question verbatim. Do not change "and" to "or" (or vice versa) inside what could be a name; do not collapse, expand, split, or pluralise names. The graph branch uses \`refinedQuestion\` as the user's literal phrase to look up records — paraphrasing breaks the lookup. If you must restructure the question, do so around the names, not over them.

Return STRICTLY: { runGraph, runContextualiser, runDrift, reasoning, refinedQuestion }.
`;

@Injectable()
export class PlannerNodeService {
  private readonly logger = new Logger(PlannerNodeService.name);

  constructor(
    private readonly llm: LLMService,
    private readonly catalog: GraphCatalogService,
  ) {}

  async execute(params: { state: ResponderContextState }): Promise<Partial<ResponderContextState>> {
    const state = params.state;
    const catalogText = this.catalog.getTypeIndexFor(state.userModuleIds ?? []);
    const history = (state.chatHistory ?? []).map((m) => ({ role: String(m.type), content: m.content }));
    const contentScope =
      state.contentId && state.contentType ? { contentType: state.contentType, contentId: state.contentId } : null;

    try {
      const out = await this.llm.call<z.infer<typeof PlannerOutputSchema>>({
        systemPrompts: [PLANNER_SYSTEM_PROMPT],
        inputSchema: PlannerInputSchema,
        inputParams: {
          rawQuestion: state.rawQuestion,
          catalog: catalogText,
          history,
          contentScope,
        },
        outputSchema: PlannerOutputSchema,
        temperature: 0.0,
        metadata: {
          nodeName: "planner",
          agentName: "responder",
          userQuestion: state.rawQuestion,
        },
      });

      const branchPlan = {
        runGraph: out.runGraph,
        runContextualiser: out.runContextualiser,
        runDrift: out.runDrift,
        reasoning: out.reasoning,
      };
      const tokens = (out as any).tokenUsage ?? { input: 0, output: 0 };

      return {
        branchPlan,
        question: out.refinedQuestion,
        plannerError: null,
        trace: {
          planner: { reasoning: out.reasoning, branchPlan, tokens },
          totalTokens: tokens,
        } as any,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`planner LLM failed — fallback engaged: ${message}`);
      const branchPlan = {
        runGraph: true,
        runContextualiser: true,
        runDrift: false,
        reasoning: "planner_fallback",
      };
      return {
        branchPlan,
        question: state.rawQuestion,
        plannerError: message,
        trace: {
          planner: { reasoning: "planner_fallback", branchPlan, tokens: { input: 0, output: 0 } },
          totalTokens: { input: 0, output: 0 },
        } as any,
      };
    }
  }
}
