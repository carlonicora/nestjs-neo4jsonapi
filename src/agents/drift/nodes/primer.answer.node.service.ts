import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { DriftContext, DriftContextState } from "../contexts/drift.context";
import { buildInheritedAttribution } from "../../common/usage-attribution";

export const defaultPrimerPrompt = `
You are a knowledge synthesis expert analyzing community reports from a knowledge graph.

## Your Task

Given a question and relevant community summaries, provide:
1. An initial broad answer based on the community context
2. Follow-up questions that would help drill deeper into the specifics

## Guidelines

- Synthesize information from multiple community summaries
- Provide a comprehensive but high-level answer
- Generate follow-up questions that target specific details
- Rate your confidence in the answer

## Output

Provide:
- **answer**: Your initial answer synthesizing the community context (200-400 words)
- **followUpQuestions**: 2-4 specific questions to drill deeper
- **confidence**: Your confidence score (0-100) based on relevance of matched communities
`;

const outputSchema = z.object({
  answer: z.string().describe("Initial broad answer synthesizing the community context (200-400 words)"),
  followUpQuestions: z.array(z.string()).describe("2-4 specific follow-up questions to drill deeper into the topic"),
  confidence: z.number().min(0).max(100).describe("Confidence score based on relevance of matched communities"),
});

const inputSchema = z.object({
  question: z.string().describe("The user's original question"),
  communitySummaries: z.string().describe("Relevant community summaries from vector search"),
  communityCount: z.number().describe("Number of communities matched"),
});

@Injectable()
export class PrimerAnswerNodeService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly logger: AppLoggingService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.driftPrimer ?? defaultPrimerPrompt;
  }

  async execute(params: { state: typeof DriftContext.State }): Promise<Partial<DriftContextState>> {
    this.logger.debug(
      `Primer Answer Node: generating initial answer from ${params.state.matchedCommunities.length} communities`,
      "PrimerAnswerNodeService",
    );

    // Handle case where no communities were found
    if (params.state.matchedCommunities.length === 0) {
      return {
        hops: 1,
        initialAnswer: "No relevant community context found for this question.",
        followUpQuestions: [],
        confidence: 0,
        priorContext: "",
        nextStep: "synthesis",
      };
    }

    const inputParams: z.infer<typeof inputSchema> = {
      question: params.state.question,
      communitySummaries: params.state.communitySummaries,
      communityCount: params.state.matchedCommunities.length,
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

    this.logger.debug(
      `Primer Answer Node complete: ${llmResponse.followUpQuestions.length} follow-ups, confidence: ${llmResponse.confidence}`,
      "PrimerAnswerNodeService",
    );

    // Determine next step based on follow-up questions
    const hasFollowUps = llmResponse.followUpQuestions.length > 0;
    const nextStep = hasFollowUps ? "followup" : "synthesis";

    return {
      hops: 1,
      initialAnswer: llmResponse.answer,
      followUpQuestions: llmResponse.followUpQuestions,
      confidence: llmResponse.confidence,
      priorContext: llmResponse.answer,
      currentFollowUpIndex: 0,
      currentDepth: 0,
      tokens: llmResponse.tokenUsage,
      nextStep,
    };
  }
}
