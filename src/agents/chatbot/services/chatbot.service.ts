import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
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

    const tools = [
      this.describeTool.build(ctx, recorder),
      this.searchTool.build(ctx, recorder),
      this.readTool.build(ctx, recorder),
      this.traverseTool.build(ctx, recorder),
    ];
    this.logger.log(`run: bound tools=${JSON.stringify(tools.map((t: any) => t.name))}`);

    const history = params.messages.map((m) => ({
      role:
        m.role === "user"
          ? AgentMessageType.User
          : m.role === "assistant"
            ? AgentMessageType.Assistant
            : AgentMessageType.System,
      content: m.content,
    }));

    const RETRY_INSTRUCTION = `Your previous attempt did not call any tools and did not return any references. The user's question requires you to use the provided tools to retrieve data. You MUST call at least one tool (search_entities, traverse, read_entity, or describe_entity) to answer. Call the appropriate tool now.`;

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
