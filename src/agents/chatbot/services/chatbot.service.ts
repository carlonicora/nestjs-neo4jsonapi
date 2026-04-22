import { Injectable, Logger, Optional } from "@nestjs/common";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { LLMService } from "../../../core/llm/services/llm.service";
import { GraphCatalogService } from "./graph.catalog.service";
import { ToolFactory, ToolCallRecord } from "../tools/tool.factory";
import { DescribeEntityTool } from "../tools/describe-entity.tool";
import { SearchEntitiesTool } from "../tools/search-entities.tool";
import { ReadEntityTool } from "../tools/read-entity.tool";
import { TraverseTool } from "../tools/traverse.tool";
import { renderChatbotSystemPrompt } from "../prompts/chatbot.system.prompt";
import { ChatbotResponseInterface } from "../interfaces/chatbot.response.interface";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { humanizeTool } from "./humanize-tool";

const MAX_TOOL_ITERATIONS = 15;

const outputSchema = z.object({
  answer: z.string(),
  references: z.array(z.object({ type: z.string(), id: z.string(), reason: z.string() })),
  needsClarification: z.boolean(),
  suggestedQuestions: z.array(z.string()).max(5),
});

export interface ChatbotRunParams {
  companyId: string;
  userId: string;
  userModules: string[];
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  /** Optional — populated on subsequent turns; undefined on the first send of a new thread. */
  assistantId?: string;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly llm: LLMService,
    private readonly graph: GraphCatalogService,
    private readonly factory: ToolFactory,
    private readonly describeTool: DescribeEntityTool,
    private readonly searchTool: SearchEntitiesTool,
    private readonly readTool: ReadEntityTool,
    private readonly traverseTool: TraverseTool,
    @Optional() private readonly ws?: WebSocketService,
  ) {}

  async run(params: ChatbotRunParams): Promise<ChatbotResponseInterface> {
    this.logger.log(
      `run: userId=${params.userId} companyId=${params.companyId} userModules=${JSON.stringify(params.userModules)} messageCount=${params.messages.length}`,
    );

    if (!params.userModules.length) {
      this.logger.warn(`run: empty userModules — returning clean refusal without invoking LLM`);
      return {
        type: AgentMessageType.Assistant,
        answer: "You have no enabled modules with described data — there is nothing I can query.",
        references: [],
        needsClarification: false,
        suggestedQuestions: [],
        tokens: { input: 0, output: 0 },
        toolCalls: [],
      };
    }

    const ctx = {
      companyId: params.companyId,
      userId: params.userId,
      userModules: params.userModules,
    };
    const recorder: ToolCallRecord[] = [];

    const graphMap = this.graph.getMapFor(params.userModules);
    this.logger.log(`run: graph map length=${graphMap.length} chars`);
    this.logger.debug(`run: graph map contents:\n${graphMap}`);

    const systemPrompt = renderChatbotSystemPrompt(graphMap);

    let tools = [
      this.describeTool.build(ctx, recorder),
      this.searchTool.build(ctx, recorder),
      this.readTool.build(ctx, recorder),
      this.traverseTool.build(ctx, recorder),
    ];
    this.logger.log(`run: bound tools=${JSON.stringify(tools.map((t: any) => t.name))}`);

    if (this.ws) {
      const ws = this.ws;
      const userId = params.userId;
      const assistantId = params.assistantId;
      tools = tools.map(
        (t: any) =>
          new DynamicStructuredTool({
            name: t.name,
            description: t.description,
            schema: t.schema,
            func: async (input: Record<string, unknown>) => {
              try {
                await ws.sendMessageToUser(userId, "assistant:status", {
                  assistantId,
                  status: humanizeTool(t.name, input),
                  at: new Date().toISOString(),
                });
              } catch (err) {
                // Non-fatal — status updates are progress hints, not functional.
                this.logger.warn(`assistant:status emit failed: ${err instanceof Error ? err.message : String(err)}`);
              }
              return t.func(input);
            },
          }),
      );
    }

    const history = params.messages.map((m) => ({
      role:
        m.role === "user"
          ? AgentMessageType.User
          : m.role === "assistant"
            ? AgentMessageType.Assistant
            : AgentMessageType.System,
      content: m.content,
    }));

    const RETRY_INSTRUCTION = `Your previous attempt did not call any tools and did not return any references. You cannot know whether the user's question is ambiguous without searching first — so "needsClarification: true" is NOT a valid response at this stage.

You MUST call at least one tool BEFORE responding. For a question that names an entity (e.g., "Show me the last order from Acme"), the first tool call is always:

    search_entities({ type: "<type from the data graph above>", text: "<the user's literal string>" })

Use the entity types listed in the data graph above. Do not respond with text — call the tool now.`;

    this.logger.log(
      `run: calling LLM (first attempt) with historyLength=${history.length} maxToolIterations=${MAX_TOOL_ITERATIONS}`,
    );
    let started = Date.now();
    let response: any = await this.llm.call({
      systemPrompts: [systemPrompt],
      history,
      outputSchema,
      inputParams: {},
      tools,
      maxToolIterations: MAX_TOOL_ITERATIONS,
      temperature: 0.1,
    });
    this.logger.log(
      `run: first-attempt LLM returned in ${Date.now() - started}ms | toolCallsObserved=${recorder.length} | referencesCount=${response.references?.length ?? 0}`,
    );

    if (recorder.length === 0 && (response.references?.length ?? 0) === 0) {
      this.logger.warn(`run: LLM returned no tool calls AND no references — retrying once with enforcement prompt`);
      started = Date.now();
      response = await this.llm.call({
        systemPrompts: [systemPrompt, RETRY_INSTRUCTION],
        history,
        outputSchema,
        inputParams: {},
        tools,
        maxToolIterations: MAX_TOOL_ITERATIONS,
        temperature: 0.1,
      });
      this.logger.log(
        `run: retry LLM returned in ${Date.now() - started}ms | toolCallsObserved=${recorder.length} | referencesCount=${response.references?.length ?? 0}`,
      );
    }

    // Error-recovery retry. If the LLM hit a tool error and bounced an
    // apology to the user instead of correcting the call, force another pass
    // with the error details and instructions to retry the failing tool
    // with valid arguments. The enhanced error messages from the tools
    // already include the list of valid fields/relationships — the retry
    // just has to point the LLM back at them.
    const erroredCalls = recorder.filter((c) => c.error);
    const answerSoundsApologetic =
      /^\s*(i am sorry|i'm sorry|i am unable|i cannot|please provide|could you (please )?specify)/i.test(
        response.answer ?? "",
      );
    if (erroredCalls.length > 0 && answerSoundsApologetic) {
      this.logger.warn(
        `run: LLM bounced apology after tool error(s) — retrying with recovery prompt (${erroredCalls.length} errored calls)`,
      );
      const lastError = erroredCalls[erroredCalls.length - 1];
      const recoveryInstruction = `A previous tool call failed and you responded to the user with an apology instead of retrying. That is wrong — the user did not cause the error. Read the error message carefully, correct the arguments, and call the tool again.

Most recent failing call:
  tool: ${lastError.tool}
  input: ${JSON.stringify(lastError.input)}
  error: ${lastError.error}

If the error lists valid fields or relationships, pick one of those and retry NOW. Do not respond to the user until the tool succeeds or you have exhausted sensible options. Do not open your final answer with "I am sorry" or "I cannot".`;
      started = Date.now();
      response = await this.llm.call({
        systemPrompts: [systemPrompt, recoveryInstruction],
        history,
        outputSchema,
        inputParams: {},
        tools,
        maxToolIterations: MAX_TOOL_ITERATIONS,
        temperature: 0.1,
      });
      this.logger.log(
        `run: recovery retry LLM returned in ${Date.now() - started}ms | toolCallsObserved=${recorder.length} | referencesCount=${response.references?.length ?? 0}`,
      );
    }

    // Post-retry honesty guard. If the LLM still ships needsClarification: true
    // without having called any tool, it is refusing to search — not actually
    // dealing with ambiguous data. Replace the lazy clarification with a clear
    // failure message so the user knows the assistant did not even look.
    if (recorder.length === 0 && response.needsClarification) {
      this.logger.warn(
        `run: LLM set needsClarification=true with 0 tool calls after retry — rewriting to honest failure`,
      );
      response = {
        ...response,
        answer:
          "I was unable to answer this question — I did not call any tool to look up data for it, so I cannot provide a real response. Please try rephrasing, or ask about a specific entity by name.",
        references: [],
        suggestedQuestions: [],
        needsClarification: false,
      };
    }

    this.logger.log(
      `run: final response | toolCallsObserved=${recorder.length} | needsClarification=${response.needsClarification} | referencesCount=${response.references?.length ?? 0} | tokens=${JSON.stringify(response.tokenUsage ?? {})}`,
    );

    return {
      type: AgentMessageType.Assistant,
      answer: response.answer,
      references: response.references,
      needsClarification: response.needsClarification,
      suggestedQuestions: response.suggestedQuestions,
      tokens: response.tokenUsage ?? { input: 0, output: 0 },
      toolCalls: recorder,
    };
  }
}
