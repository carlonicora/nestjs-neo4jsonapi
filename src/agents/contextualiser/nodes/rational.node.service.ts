import { Inject, Injectable, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { z } from "zod";
import { LLMService } from "../../../core/llm/services/llm.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";
import { CONTEXTUALISER_RATIONAL_PROMPT } from "../../prompts/prompt.tokens";

export const defaultRationalPlanPrompt = `
As an intelligent assistant, your primary objective is to answer the question by gathering supporting facts from a given article.
To facilitate this objective, the first step is to make a rational plan based on the question and previous context.
This plan should outline the step-by-step process to resolve the question and specify the key information required to formulate a comprehensive answer.

### **Instructions:**
1. **Understand the Question**:
   - Carefully read the question to determine exactly what is being asked.

2. **Consider the previous analysis if present**:
   - Carefully read the analysis of previous questions to understand the context and any relevant information that may assist in answering the question.

3. **Create a Rational Plan**:
   - **Outline a clear, step-by-step plan** to resolve the question.
   - **Specify the key information required** to formulate a comprehensive answer.
   - The plan should be logical and methodical, detailing how you will approach finding the answer.
   - The plan should be specific and help you analyse the information effectively.

4. **Provide a Status Message**:
  - Write a **short, friendly message** (maximum 40 characters) about your action.
  - **Avoid technical terms** such as "nodes", "atomic facts", or "key concepts".
  - The status message should make the user understand the action being taken
  - The status message **MUST** contain clear information contextualised to the current question and the gathered information.
  - The status message should be specific to the context and clearly convey the next steps or actions being taken.
  - The status message **MUST NOT** be something unrelated to the text, such as "success", "sufficient information", "insufficient information", "chunk analysed", "chunk processed" or similar generic messages.

### **Please strictly follow the above instructions and format. Let's begin.**
`;

const outputSchema = z.object({
  status: z
    .string()
    .describe(
      `Write a short, friendly message (max 40 characters) about your action, avoiding technical terms such as "nodes" or "atomic facts" or "key concepts". Give flavour to the message and avoid repeating the same message.`,
    ),
  rationalPlan: z
    .string()
    .describe(`The rational plan that will be used to provide a comprehensive answer to the user question`),
});

const inputSchema = z.object({
  question: z.string().describe("The user question"),
  analysis: z.string().optional().describe("The analysis of previous questions"),
});

@Injectable()
export class RationalNodeService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly webSocketService: WebSocketService,
    private readonly clsService: ClsService,
    @Optional() @Inject(CONTEXTUALISER_RATIONAL_PROMPT) customPrompt?: string,
  ) {
    this.systemPrompt = customPrompt ?? defaultRationalPlanPrompt;
  }

  async execute(params: { state: typeof ContextualiserContext.State }): Promise<Partial<ContextualiserContextState>> {
    params.state.hops += 1;

    const inputParams: z.infer<typeof inputSchema> = {
      question: params.state.question,
      analysis: params.state.previousAnalysis,
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
      rationalPlan: llmResponse.rationalPlan,
      nextStep: "key_concepts",
      status: [llmResponse.status],
      tokens: llmResponse.tokenUsage,
    };
  }
}
