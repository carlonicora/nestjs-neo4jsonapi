import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import {
  BaseConfigInterface,
  ConfigPromptsInterface,
  ConfigResponderInterface,
  GraphNodeDomainPrompts,
} from "../../../config/interfaces";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { LLMService } from "../../../core/llm/services/llm.service";
import { TokenUsageType } from "../../../foundations/tokenusage/enums/tokenusage.type";
import { buildScopeAttribution } from "../../common/usage-attribution";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";
import { ToolFactory, ToolCallRecord } from "../../graph/tools/tool.factory";
import { ResolveEntityTool } from "../../graph/tools/resolve-entity.tool";
import { DescribeEntityTool } from "../../graph/tools/describe-entity.tool";
import { SearchEntitiesTool } from "../../graph/tools/search-entities.tool";
import { ReadEntityTool } from "../../graph/tools/read-entity.tool";
import { TraverseTool } from "../../graph/tools/traverse.tool";
import { describeDomainLayer, renderGraphNodeSystemPrompt } from "../../graph/prompts/graph.node.system.prompt";
import { collectEntityLabels, humanizeTool } from "../../graph/services/humanize-tool";
import type { GraphNodeOutput } from "../../graph/interfaces/graph.node.output.interface";
import { ResponderContextState } from "../contexts/responder.context";

export const MAX_TOOL_ITERATIONS = 15;
// Enforced at retry boundaries: once a turn has spent this budget (or the
// iteration cap) no further retry pass is launched — the in-flight llm.call
// itself cannot be interrupted mid-loop. Also labels `status` after the fact.
export const GRAPH_NODE_WALL_CLOCK_MS = 60_000;

export const RETRY_INSTRUCTION = `Your previous attempt did not call any tools. You cannot answer a question about this system's data without first looking it up.

You must call at least one tool BEFORE producing a final answer. For a question that names an entity (a person, a place, an organisation, a project — anything that could correspond to a record in the graph), the first tool call is always:

    resolve_entity({ text: "<the user's literal phrase>" })

Inspect the returned candidates, pick a type, then call describe_entity and proceed with the typed tools (read_entity, search_entities, traverse) until you have the data the answer needs. Do not respond with prose alone — call the tool now.`;

export const TRAVERSAL_RETRY_INSTRUCTION = `Your previous attempt answered without a single successful traverse call. A record's own fields describe it as it was when the record was written; what has happened to it since lives on the records that reference it, and those are reachable only by walking a relationship.

Decide which case this question is:
- If it asks what a record IS and that record's own fields fully answer it, return your answer unchanged.
- Otherwise, call describe_entity on the subject's type if you have not already, pick the relationships that lead to the records referencing it, call traverse along each, read what comes back, and rebuild your answer from those records.

Do not return the previous answer unchanged unless the first case truly applies.`;

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
export class GraphNodeService implements OnModuleInit {
  private readonly logger = new Logger(GraphNodeService.name);
  private readonly domain?: GraphNodeDomainPrompts;
  private readonly graphTuning?: ConfigResponderInterface["graph"];

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
    private readonly configService: ConfigService<BaseConfigInterface>,
    @Optional() private readonly ws?: WebSocketService,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.domain = prompts?.graphNodeDomain;
    this.graphTuning = this.configService.get<ConfigResponderInterface>("responder")?.graph;
  }

  onModuleInit(): void {
    const t = this.graphTuning;
    this.logger.log(
      `${describeDomainLayer(this.domain)} | tier=${t?.modelWeight ?? "normal"} ` +
        `effort=${t?.reasoningEffort ?? "tier-default"} ` +
        `traversalGuard=${t?.requireTraversalBeforeAnswer ? "on" : "off"}`,
    );
  }

  async execute(params: { state: ResponderContextState }): Promise<Partial<ResponderContextState>> {
    const state = params.state;
    // Every graph tool built below reads scopeId/scopeType off this context —
    // it is the only channel confining the whole turn to one scope root.
    const ctx = {
      companyId: state.companyId,
      userId: state.userId,
      userModuleIds: state.userModuleIds ?? [],
      scopeId: state.scopeId,
      scopeType: state.scopeType,
    };

    if (ctx.userModuleIds.length === 0) {
      const out: GraphNodeOutput = {
        answer: "",
        entities: [],
        toolCalls: [],
        tokens: { input: 0, output: 0 },
        status: "skipped_no_modules",
      };
      return {
        graphContext: out,
        graphError: null,
        tokens: out.tokens,
        trace: { graph: this.traceFromOutput(out) } as any,
      };
    }

    const recorder: ToolCallRecord[] = [];
    const typeIndex = this.graph.getTypeIndexFor(ctx.userModuleIds);
    const systemPrompt = renderGraphNodeSystemPrompt(typeIndex, this.domain);

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
      // id → human label, harvested from each tool result as the turn runs.
      // The id-taking tools (read_entity, traverse) only ever receive a uuid,
      // so without this the status line can only print the uuid back at the
      // user. resolve_entity/search_entities run first and carry the names.
      const labels = new Map<string, string>();
      tools = tools.map(
        (t) =>
          new DynamicStructuredTool({
            name: t.name,
            description: t.description,
            schema: t.schema as any,
            func: async (input: Record<string, unknown>) => {
              try {
                await ws.sendMessageToUser(userId, "assistant:status", {
                  status: humanizeTool(t.name, input, labels),
                  at: new Date().toISOString(),
                });
              } catch (err) {
                this.logger.warn(`assistant:status emit failed: ${err instanceof Error ? err.message : String(err)}`);
              }
              const result = await t.func(input as any);
              try {
                collectEntityLabels(result, labels);
              } catch (err) {
                this.logger.warn(
                  `assistant:status label harvest failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
              return result;
            },
          }),
      );
    }

    const history = (state.chatHistory ?? []).map((m) => ({
      role: ((m as any).role ?? (m as any).type) as any,
      content: m.content,
    }));
    const startedAt = Date.now();
    // One shape for the first pass and every retry: same params, same knobs,
    // same attribution — only the appended instruction differs. The graph
    // tuning knobs (tier / effort) come from `responder.graph` config; unset
    // keeps the Normal tier and its tier-default effort.
    const call = (extraInstruction?: string) =>
      this.llm.call({
        systemPrompts: extraInstruction ? [systemPrompt, extraInstruction] : [systemPrompt],
        history,
        outputSchema: graphOutputSchema,
        inputParams: {
          question: state.question,
          contentScope: state.contentId && state.contentType ? `${state.contentType}:${state.contentId}` : null,
        },
        tools,
        maxToolIterations: MAX_TOOL_ITERATIONS,
        temperature: 0.1,
        ...(this.graphTuning?.modelWeight !== undefined ? { modelWeight: this.graphTuning.modelWeight } : {}),
        ...(this.graphTuning?.reasoningEffort !== undefined
          ? { reasoningEffort: this.graphTuning.reasoningEffort }
          : {}),
        metadata: this.buildMetadata(state),
        ...this.attribution(state),
      });
    // The recorder is shared across passes, so retries stacked on a full
    // first pass are how a single turn once reached 23 tool calls and 1.4M
    // input tokens. A retry only launches while the turn has budget left; the
    // zero-tool retry stays unconditional because an empty recorder means the
    // iteration budget is untouched and no answer exists yet.
    const retryBudgetLeft = () =>
      recorder.length < MAX_TOOL_ITERATIONS && Date.now() - startedAt < GRAPH_NODE_WALL_CLOCK_MS;

    try {
      let response: any = await call();

      // Zero-tool-call retry: the first attempt produced no searches at all.
      // Re-invoke with an explicit instruction that data must be looked up
      // before answering.
      if (recorder.length === 0) {
        this.logger.warn(`graph node: zero tool calls on first attempt — retrying with RETRY_INSTRUCTION`);
        response = await call(RETRY_INSTRUCTION);
      }

      // Error-recovery retry: at least one tool call failed AND the model
      // bounced an apology to the user instead of correcting and retrying.
      // Force another pass with the failing call's error message in context.
      const erroredCalls = recorder.filter((c) => c.error);
      const answerSoundsApologetic = APOLOGY_REGEX.test(typeof response.answer === "string" ? response.answer : "");
      if (erroredCalls.length > 0 && answerSoundsApologetic && retryBudgetLeft()) {
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
        response = await call(recoveryInstruction);
      }

      // Structural data-loading retry: the LLM made tool calls but none of
      // them successfully loaded data (read_entity / search_entities /
      // traverse), AND returned no entities. This catches the most common
      // laziness mode: the LLM resolves an entity, sees ambiguity or
      // missing relationships, and gives up before fetching the records.
      // Detected structurally — no regex on answer text.
      const dataLoadingTools = new Set(["read_entity", "search_entities", "traverse"]);
      const dataToolCallsBefore = recorder.filter((c) => dataLoadingTools.has(c.tool) && !c.error).length;
      if (recorder.length > 0 && dataToolCallsBefore === 0 && retryBudgetLeft()) {
        const triedTools = Array.from(new Set(recorder.map((c) => c.tool))).join(", ");
        const dataLoadingRetry = `Your previous attempt called ${triedTools} but never successfully loaded data with read_entity, search_entities, or traverse. The user asked a data question; you must answer it.

Steps to take now:
  1. Re-read your previous resolve_entity results. Pick the most plausible candidate by name match — an item whose name equals the user's literal phrase is the right pick.
  2. Call describe_entity on the type(s) the question is about (both the resolved entity's type AND any target type the user is asking about).
  3. Call traverse from the resolved entity along the relationship that leads to the records the user wants. If no direct relationship is listed, use search_entities on the target type with appropriate filters.
  4. Call read_entity on each result to get the full fields.
  5. Return the records in entities, with their fields populated.

Proceed now. Do not refuse, do not ask the user to clarify, do not apologise.`;
        this.logger.warn(
          `graph node: ${recorder.length} tool call(s), 0 successful data loads — retrying with data-loading instruction`,
        );
        response = await call(dataLoadingRetry);
      }

      // Traversal guard (opt-in via responder.graph.requireTraversalBeforeAnswer):
      // tool calls happened — data may even have been read — but no edge was
      // walked. That is the shape that answers a state question from the
      // subject's own stale fields and presents the past as the present. One
      // structural retry; the instruction explicitly lets a fields-only answer
      // stand when the question is a pure identity lookup.
      const successfulTraverses = recorder.filter((c) => c.tool === "traverse" && !c.error).length;
      if (this.graphTuning?.requireTraversalBeforeAnswer && recorder.length > 0 && successfulTraverses === 0) {
        if (retryBudgetLeft()) {
          this.logger.warn(
            `graph node: ${recorder.length} tool call(s), 0 successful traverses — retrying with traversal instruction`,
          );
          response = await call(this.domain?.traversalRetry?.trim() || TRAVERSAL_RETRY_INSTRUCTION);
        } else {
          this.logger.warn(
            `graph node: traversal guard skipped — budget exhausted ` +
              `(calls=${recorder.length}, elapsedMs=${Date.now() - startedAt})`,
          );
        }
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
      return {
        graphContext: out,
        graphError: null,
        tokens: out.tokens,
        trace: { graph: this.traceFromOutput(out) } as any,
      };
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
      return {
        graphContext: out,
        graphError: message,
        tokens: out.tokens,
        trace: { graph: this.traceFromOutput(out) } as any,
      };
    }
  }

  private traceFromOutput(out: GraphNodeOutput) {
    const materialisedBridges: { tool: string; type: string; count: number }[] = [];
    for (const c of out.toolCalls) {
      if (!c.materialised?.length) continue;
      const total = c.materialised.reduce((acc, m) => acc + m.count, 0);
      const inputType =
        typeof (c.input as any).type === "string"
          ? ((c.input as any).type as string)
          : typeof (c.input as any).fromType === "string"
            ? ((c.input as any).fromType as string)
            : "?";
      materialisedBridges.push({ tool: c.tool, type: inputType, count: total });
    }
    return {
      toolCalls: out.toolCalls,
      entitiesDiscovered: out.entities.length,
      status: out.status,
      errorMessage: out.errorMessage,
      tokens: out.tokens,
      ...(materialisedBridges.length ? { materialisedBridges } : {}),
    };
  }

  /**
   * Cost attribution for EVERY llm.call this node makes. The retries below the
   * first pass are billed by the provider exactly like the first one, so each
   * carries the same attribution.
   */
  private attribution(state: ResponderContextState) {
    return buildScopeAttribution({
      tokenUsageType: TokenUsageType.Responder,
      scopeId: state.scopeId,
      scopeType: state.scopeType,
      scopeLabel: state.scopeLabel,
      assistantId: state.assistantId,
    });
  }

  private buildMetadata(state: ResponderContextState) {
    return {
      nodeName: "graph",
      agentName: "responder",
      userQuestion: state.question,
    };
  }
}
