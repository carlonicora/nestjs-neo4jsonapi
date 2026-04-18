import { Injectable } from "@nestjs/common";
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
    if (!params.userModules.length) {
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

    const systemPrompt = renderChatbotSystemPrompt(this.graph.getMapFor(params.userModules));

    const tools = [
      this.describeTool.build(ctx, recorder),
      this.searchTool.build(ctx, recorder),
      this.readTool.build(ctx, recorder),
      this.traverseTool.build(ctx, recorder),
    ];

    const history = params.messages.map((m) => ({
      role:
        m.role === "user"
          ? AgentMessageType.User
          : m.role === "assistant"
            ? AgentMessageType.Assistant
            : AgentMessageType.System,
      content: m.content,
    }));

    const response: any = await this.llm.call({
      systemPrompts: [systemPrompt],
      history,
      outputSchema,
      inputParams: {},
      tools,
      maxToolIterations: 10,
      temperature: 0.1,
    });

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
