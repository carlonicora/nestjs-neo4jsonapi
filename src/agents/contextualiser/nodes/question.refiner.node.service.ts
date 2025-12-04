import { Inject, Injectable, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { z } from "zod";
import { LLMService } from "../../../core/llm/services/llm.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";
import { CONTEXTUALISER_QUESTION_REFINER_PROMPT } from "../../prompts/prompt.tokens";

export const defaultQuestionRefinerPrompt = `
Your task: Create a single, focused question that captures the user's current intent based on the conversation history.

### ANALYSIS PROCESS:
1. Identify the user's LATEST question or intent
2. Determine if previous questions provide essential context for understanding the current intent
3. Focus on what the user wants to know RIGHT NOW

### DECISION RULES:

**IF the latest question builds directly on previous questions**: Create a refined question that incorporates necessary context.

**IF the latest question shifts focus or asks something different**: Return ONLY a question focused on the current intent, ignoring irrelevant history.

### KEY PRINCIPLES:
- The user's CURRENT interest takes absolute priority
- Don't combine questions just because they share the same subject
- If the user has moved on from a topic, don't bring it back
- Return ONLY the question - no explanations, no reasoning, no analysis

### EXAMPLES:

**Scenario 1 - Building Context:**
History: "How do I install Redis?" → "What port does it use?"
Output: "How do I install Redis and what port does it use?"

**Scenario 2 - Shifted Focus:**  
History: "How do I install Redis?" → "What are Redis performance benchmarks?"
Output: "What are Redis performance benchmarks?"

**Scenario 3 - Different Aspect:**
History: "What is Company X?" → "What are Company X's strengths?" → "Who founded Company X?"
Output: "Who founded Company X?"

### FORMAT REQUIREMENT:
- Return ONLY a single question
- No explanations, rationale, or context descriptions
- Must end with a question mark
- Must be grammatically complete
`;

const outputSchema = z.object({
  status: z
    .string()
    .describe(
      `Write a short, friendly message (max 40 characters) about your action, avoiding technical terms such as "nodes" or "atomic facts" or  "key concepts". Give flavour to the message and avoid  repeating the same message.`,
    ),
  response: z
    .string()
    .describe(
      `A single question that captures the user's current intent. Must be a complete question ending with '?'. No explanations or reasoning allowed.`,
    ),
});

const inputSchema = z.object({
  chatHistory: z
    .array(
      z.object({
        type: z.string().describe("The type of the chat message"),
        content: z.string().describe("The content of the chat message"),
      }),
    )
    .describe("The chat history"),
});

@Injectable()
export class QuestionRefinerNodeService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly webSocketService: WebSocketService,
    private readonly clsService: ClsService,
    @Optional() @Inject(CONTEXTUALISER_QUESTION_REFINER_PROMPT) customPrompt?: string,
  ) {
    this.systemPrompt = customPrompt ?? defaultQuestionRefinerPrompt;
  }

  async execute(params: { state: typeof ContextualiserContext.State }): Promise<Partial<ContextualiserContextState>> {
    params.state.hops += 1;

    if (params.state.chatHistory.length === 0) return params.state;

    const inputParams: z.infer<typeof inputSchema> = {
      chatHistory: [
        ...params.state.chatHistory,
        {
          type: "user",
          content: params.state.question,
        },
      ],
    };

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema: inputSchema,
      inputParams: inputParams,
      outputSchema: outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.1,
    });

    if (params.state.contentType === "Conversation")
      await this.webSocketService.sendMessageToUser(this.clsService.get("userId"), "contextualiser", {
        message: llmResponse.status,
        conversationId: params.state.contentId,
      });

    const returnedHops = params.state.hops + 1;
    return {
      hops: returnedHops,
      question: llmResponse.response,
      tokens: llmResponse.tokenUsage,
    };
  }
}
