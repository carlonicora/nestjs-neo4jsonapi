import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { DriftContext, DriftContextState } from "../contexts/drift.context";
import { buildInheritedAttribution } from "../../common/usage-attribution";

export const defaultSynthesisPrompt = `
You are a knowledge synthesis expert producing a final comprehensive answer.

## Your Task

Synthesize all gathered information into a final, comprehensive answer to the user's question.

## Input

You will receive:
1. The original question
2. An initial broad answer from community context
3. Detailed answers from follow-up investigations

## Guidelines

- Integrate all relevant information cohesively
- Structure your response clearly
- Cite specific entities and relationships when relevant
- Acknowledge any limitations or gaps in the available information
- Be comprehensive but concise

## Output

Provide a final comprehensive answer (300-600 words) that addresses the user's question
using all available context.
`;

const outputSchema = z.object({
  finalAnswer: z.string().describe("Final comprehensive answer synthesizing all gathered information (300-600 words)"),
});

const inputSchema = z.object({
  question: z.string().describe("The original user question"),
  initialAnswer: z.string().describe("Initial broad answer from community context"),
  followUpAnswers: z.string().describe("Detailed answers from follow-up investigations"),
  confidence: z.number().describe("Overall confidence from the primer phase"),
});

@Injectable()
export class SynthesisNodeService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly logger: AppLoggingService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.driftSearch ?? defaultSynthesisPrompt;
  }

  async execute(params: { state: typeof DriftContext.State }): Promise<Partial<DriftContextState>> {
    this.logger.debug(
      `Synthesis Node: synthesizing answer from ${params.state.followUpAnswers.length} follow-ups`,
      "SynthesisNodeService",
    );

    // Handle case where no communities were matched
    if (params.state.matchedCommunities.length === 0) {
      return {
        hops: 1,
        finalAnswer: params.state.initialAnswer || "No relevant information found in the knowledge base.",
        nextStep: "end",
      };
    }

    // Format follow-up answers for LLM
    const followUpAnswers =
      params.state.followUpAnswers.length > 0
        ? params.state.followUpAnswers.map((f) => `**Q: ${f.question}**\n${f.answer}`).join("\n\n")
        : "No follow-up investigations were conducted.";

    const inputParams: z.infer<typeof inputSchema> = {
      question: params.state.question,
      initialAnswer: params.state.initialAnswer,
      followUpAnswers,
      confidence: params.state.confidence,
    };

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema: inputSchema,
      inputParams: inputParams,
      outputSchema: outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.3,
      // Billed to the CALLING agent: its ledger category, its entity. Spread
      // LAST so nothing above can overwrite the attribution.
      ...buildInheritedAttribution(params.state),
    });

    this.logger.debug(`Synthesis Node complete: generated final answer`, "SynthesisNodeService");

    return {
      hops: 1,
      finalAnswer: llmResponse.finalAnswer,
      tokens: llmResponse.tokenUsage,
      nextStep: "end",
    };
  }
}
