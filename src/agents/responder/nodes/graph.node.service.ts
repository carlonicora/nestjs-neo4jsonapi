import { Injectable, Logger, Optional } from "@nestjs/common";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { LLMService } from "../../../core/llm/services/llm.service";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";
import { ToolFactory, ToolCallRecord } from "../../graph/tools/tool.factory";
import { ResolveEntityTool } from "../../graph/tools/resolve-entity.tool";
import { DescribeEntityTool } from "../../graph/tools/describe-entity.tool";
import { SearchEntitiesTool } from "../../graph/tools/search-entities.tool";
import { ReadEntityTool } from "../../graph/tools/read-entity.tool";
import { TraverseTool } from "../../graph/tools/traverse.tool";
import { renderGraphNodeSystemPrompt } from "../../graph/prompts/graph.node.system.prompt";
import { humanizeTool } from "../../graph/services/humanize-tool";
import type { GraphNodeOutput } from "../../graph/interfaces/graph.node.output.interface";
import { ResponderContextState } from "../contexts/responder.context";

export const MAX_TOOL_ITERATIONS = 15;
export const GRAPH_NODE_WALL_CLOCK_MS = 60_000;

const RETRY_INSTRUCTION = `Your previous attempt did not call any tools. You cannot answer a question about the company's data without first looking it up.

You must call at least one tool BEFORE producing a final answer. For a question that names an entity (a customer, person, product, project, work order, anything that could correspond to a record in the graph), the first tool call is always:

    resolve_entity({ text: "<the user's literal phrase>" })

Inspect the returned candidates, pick a type, then call describe_entity and proceed with the typed tools (read_entity, search_entities, traverse) until you have the data the answer needs. Do not respond with prose alone — call the tool now.`;

const APOLOGY_REGEX = /^\s*(i am sorry|i'm sorry|i am unable|i cannot|please provide|could you (please )?specify)/i;

const graphOutputSchema = z.object({
  answer: z.string(),
  entities: z.array(
    z.object({
      type: z.string(),
      id: z.string(),
      reason: z.string(),
      fields: z.record(z.string(), z.any()).optional(),
    }),
  ),
  stop: z.boolean(),
});

@Injectable()
export class GraphNodeService {
  private readonly logger = new Logger(GraphNodeService.name);

  constructor(
    private readonly llm: LLMService,
    private readonly graph: GraphCatalogService,
    // Preserved for DI shape compatibility with the (deleted) ChatbotService.
    // Task 9.2 will decide whether to keep it. Do not remove.

    private readonly factory: ToolFactory,
    private readonly resolveTool: ResolveEntityTool,
    private readonly describeTool: DescribeEntityTool,
    private readonly searchTool: SearchEntitiesTool,
    private readonly readTool: ReadEntityTool,
    private readonly traverseTool: TraverseTool,
    @Optional() private readonly ws?: WebSocketService,
  ) {}

  async execute(params: { state: ResponderContextState }): Promise<Partial<ResponderContextState>> {
    const state = params.state;
    const ctx = {
      companyId: state.companyId,
      userId: state.userId,
      userModuleIds: state.userModuleIds ?? [],
    };

    if (ctx.userModuleIds.length === 0) {
      const out: GraphNodeOutput = {
        answer: "",
        entities: [],
        toolCalls: [],
        tokens: { input: 0, output: 0 },
        status: "skipped_no_modules",
      };
      return { graphContext: out, graphError: null, trace: { graph: this.traceFromOutput(out) } as any };
    }

    const recorder: ToolCallRecord[] = [];
    const graphMap = this.graph.getMapFor(ctx.userModuleIds);
    const systemPrompt = renderGraphNodeSystemPrompt(graphMap);

    let tools: DynamicStructuredTool[] = [
      this.resolveTool.build(ctx, recorder),
      this.describeTool.build(ctx, recorder),
      this.searchTool.build(ctx, recorder),
      this.readTool.build(ctx, recorder),
      this.traverseTool.build(ctx, recorder),
    ];

    if (this.ws) {
      const ws = this.ws;
      const userId = state.userId;
      tools = tools.map(
        (t) =>
          new DynamicStructuredTool({
            name: t.name,
            description: t.description,
            schema: t.schema as any,
            func: async (input: Record<string, unknown>) => {
              try {
                await ws.sendMessageToUser(userId, "assistant:status", {
                  status: humanizeTool(t.name, input),
                  at: new Date().toISOString(),
                });
              } catch (err) {
                this.logger.warn(`assistant:status emit failed: ${err instanceof Error ? err.message : String(err)}`);
              }
              return t.func(input as any);
            },
          }),
      );
    }

    const history = (state.chatHistory ?? []).map((m) => ({
      role: ((m as any).role ?? (m as any).type) as any,
      content: m.content,
    }));
    const startedAt = Date.now();

    try {
      let response: any = await this.llm.call({
        systemPrompts: [systemPrompt],
        history,
        outputSchema: graphOutputSchema,
        inputParams: {
          question: state.question,
          contentScope: state.contentId && state.contentType ? `${state.contentType}:${state.contentId}` : null,
        },
        tools,
        maxToolIterations: MAX_TOOL_ITERATIONS,
        temperature: 0.1,
        metadata: this.buildMetadata(state),
      });

      // Zero-tool-call retry: the first attempt produced no searches at all.
      // Re-invoke with an explicit instruction that data must be looked up
      // before answering.
      if (recorder.length === 0) {
        this.logger.warn(`graph node: zero tool calls on first attempt — retrying with RETRY_INSTRUCTION`);
        response = await this.llm.call({
          systemPrompts: [systemPrompt, RETRY_INSTRUCTION],
          history,
          outputSchema: graphOutputSchema,
          inputParams: {
            question: state.question,
            contentScope: state.contentId && state.contentType ? `${state.contentType}:${state.contentId}` : null,
          },
          tools,
          maxToolIterations: MAX_TOOL_ITERATIONS,
          temperature: 0.1,
          metadata: this.buildMetadata(state),
        });
      }

      // Error-recovery retry: at least one tool call failed AND the model
      // bounced an apology to the user instead of correcting and retrying.
      // Force another pass with the failing call's error message in context.
      const erroredCalls = recorder.filter((c) => c.error);
      const answerSoundsApologetic = APOLOGY_REGEX.test(typeof response.answer === "string" ? response.answer : "");
      if (erroredCalls.length > 0 && answerSoundsApologetic) {
        const lastError = erroredCalls[erroredCalls.length - 1];
        const recoveryInstruction = `A previous tool call failed and you responded to the user with an apology instead of retrying. That is wrong — the user did not cause the error. Read the error message carefully, correct the arguments, and call the tool again.

Most recent failing call:
  tool: ${lastError.tool}
  input: ${JSON.stringify(lastError.input)}
  error: ${lastError.error}

If the error lists valid fields or relationships, pick one of those and retry now. Do not respond to the user until the tool succeeds or you have exhausted sensible options. Do not open your final answer with "I am sorry" or "I cannot".`;
        this.logger.warn(
          `graph node: ${erroredCalls.length} tool error(s) + apologetic answer — retrying with recovery prompt`,
        );
        response = await this.llm.call({
          systemPrompts: [systemPrompt, recoveryInstruction],
          history,
          outputSchema: graphOutputSchema,
          inputParams: {
            question: state.question,
            contentScope: state.contentId && state.contentType ? `${state.contentType}:${state.contentId}` : null,
          },
          tools,
          maxToolIterations: MAX_TOOL_ITERATIONS,
          temperature: 0.1,
          metadata: this.buildMetadata(state),
        });
      }

      // Structural data-loading retry: the LLM made tool calls but none of
      // them successfully loaded data (read_entity / search_entities /
      // traverse), AND returned no entities. This catches the most common
      // laziness mode: the LLM resolves an entity, sees ambiguity or
      // missing relationships, and gives up before fetching the records.
      // Detected structurally — no regex on answer text.
      const dataLoadingTools = new Set(["read_entity", "search_entities", "traverse"]);
      const dataToolCallsBefore = recorder.filter((c) => dataLoadingTools.has(c.tool) && !c.error).length;
      const entitiesReturnedBefore = Array.isArray(response.entities) ? response.entities.length : 0;
      if (recorder.length > 0 && dataToolCallsBefore === 0 && entitiesReturnedBefore === 0) {
        const triedTools = Array.from(new Set(recorder.map((c) => c.tool))).join(", ");
        const dataLoadingRetry = `Your previous attempt called ${triedTools} but never successfully loaded data with read_entity, search_entities, or traverse, and returned no entities. The user asked a data question; you must answer it.

Steps to take now:
  1. Re-read your previous resolve_entity results. Pick the most plausible candidate by name match — an item whose name equals the user's literal phrase is the right pick.
  2. Call describe_entity on the type(s) the question is about (both the resolved entity's type AND any target type the user is asking about).
  3. Call traverse from the resolved entity along the relationship that leads to the records the user wants. If no direct relationship is listed, use search_entities on the target type with appropriate filters.
  4. Call read_entity on each result to get the full fields.
  5. Return the records in entities, with their fields populated.

Proceed now. Do not refuse, do not ask the user to clarify, do not apologise.`;
        this.logger.warn(
          `graph node: ${recorder.length} tool call(s), 0 successful data loads, 0 entities — retrying with data-loading instruction`,
        );
        response = await this.llm.call({
          systemPrompts: [systemPrompt, dataLoadingRetry],
          history,
          outputSchema: graphOutputSchema,
          inputParams: {
            question: state.question,
            contentScope: state.contentId && state.contentType ? `${state.contentType}:${state.contentId}` : null,
          },
          tools,
          maxToolIterations: MAX_TOOL_ITERATIONS,
          temperature: 0.1,
          metadata: this.buildMetadata(state),
        });
      }

      // Honesty rewrite: even after the zero-tool retry the model produced no
      // tool calls. Replace its `answer` with an explicit failure message
      // rather than letting the synthesizer downstream see prose pretending
      // to have looked something up.
      if (recorder.length === 0) {
        this.logger.warn(`graph node: still 0 tool calls after retry — rewriting answer to honest failure`);
        response = {
          ...response,
          answer:
            "I was unable to answer this question — I did not call any tool to look up data for it, so I cannot provide a real response. Please try rephrasing, or ask about a specific entity by name.",
          entities: [],
        };
      }

      const wallclockHit = Date.now() - startedAt > GRAPH_NODE_WALL_CLOCK_MS;
      const iterationsHit = recorder.length >= MAX_TOOL_ITERATIONS;
      const status: GraphNodeOutput["status"] = wallclockHit || iterationsHit ? "partial" : "success";

      const entities = (response.entities ?? []).map((e: any, idx: number) => ({
        type: e.type,
        id: e.id,
        reason: e.reason ?? "",
        foundAtHop: idx,
        ...(e.fields && Object.keys(e.fields).length > 0 ? { fields: e.fields } : {}),
      }));

      const answerText = typeof response.answer === "string" ? response.answer : "";

      this.logger.log(
        `graph node done: status=${status} toolCalls=${recorder.length} entities=${entities.length} ` +
          `withFields=${entities.filter((e: any) => e.fields).length} ` +
          `answerChars=${answerText.length} ` +
          `tokens=${JSON.stringify(response.tokenUsage ?? { input: 0, output: 0 })}`,
      );
      this.logger.debug(`graph node tool sequence: ${recorder.map((r) => r.tool).join(" → ") || "(none)"}`);
      this.logger.debug(
        `graph node entities returned: ${JSON.stringify(
          entities.map((e: any) => ({
            type: e.type,
            id: e.id,
            reason: e.reason,
            fieldKeys: e.fields ? Object.keys(e.fields) : [],
          })),
        )}`,
      );

      const out: GraphNodeOutput = {
        answer: answerText,
        entities,
        toolCalls: recorder,
        tokens: response.tokenUsage ?? { input: 0, output: 0 },
        status,
      };
      return { graphContext: out, graphError: null, trace: { graph: this.traceFromOutput(out) } as any };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`graph node failed: ${message}`);
      const out: GraphNodeOutput = {
        answer: "",
        entities: [],
        toolCalls: recorder,
        tokens: { input: 0, output: 0 },
        status: "failed",
        errorMessage: message,
      };
      return { graphContext: out, graphError: message, trace: { graph: this.traceFromOutput(out) } as any };
    }
  }

  private traceFromOutput(out: GraphNodeOutput) {
    return {
      toolCalls: out.toolCalls,
      entitiesDiscovered: out.entities.length,
      status: out.status,
      errorMessage: out.errorMessage,
      tokens: out.tokens,
    };
  }

  private buildMetadata(state: ResponderContextState) {
    return {
      nodeName: "graph",
      agentName: "responder",
      userQuestion: state.question,
    };
  }
}
