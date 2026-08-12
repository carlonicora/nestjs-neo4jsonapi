import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { DriftContext, DriftContextState, FollowUpAnswer } from "../contexts/drift.context";
import { buildInheritedAttribution } from "../../common/usage-attribution";

export const defaultFollowupPrompt = `
You are a knowledge analyst conducting a detailed investigation.

## Your Task

Given a follow-up question and community context, provide:
1. A detailed answer to the specific question
2. Additional follow-up questions if the investigation should continue

## Guidelines

- Focus on answering the specific follow-up question
- Use entity details and relationships from the community members
- Be specific and cite relevant entities when possible
- Only suggest more follow-up questions if there are clear gaps to explore

## Output

Provide:
- **answer**: Detailed answer to the follow-up question (100-300 words)
- **additionalQuestions**: 0-2 additional questions if further investigation is needed
- **shouldContinue**: Whether the investigation should continue (true if important gaps remain)
`;

const outputSchema = z.object({
  answer: z.string().describe("Detailed answer to the follow-up question (100-300 words)"),
  additionalQuestions: z.array(z.string()).describe("0-2 additional questions if further investigation is needed"),
  shouldContinue: z.boolean().describe("Whether the investigation should continue"),
});

const inputSchema = z.object({
  originalQuestion: z.string().describe("The original user question"),
  followUpQuestion: z.string().describe("The current follow-up question to answer"),
  priorContext: z.string().describe("Context gathered from prior investigation steps"),
  communityDetails: z.string().describe("Details about community members and relationships"),
});

@Injectable()
export class FollowUpNodeService {
  private readonly systemPrompt: string;
  private readonly maxQuestionsPerStep = 3;

  constructor(
    private readonly llmService: LLMService,
    private readonly communityRepository: CommunityRepository,
    private readonly logger: AppLoggingService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.driftFollowup ?? defaultFollowupPrompt;
  }

  async execute(params: { state: typeof DriftContext.State }): Promise<Partial<DriftContextState>> {
    const { state } = params;
    const currentIndex = state.currentFollowUpIndex;
    const currentDepth = state.currentDepth;

    this.logger.debug(
      `FollowUp Node: processing question ${currentIndex + 1}/${state.followUpQuestions.length} at depth ${currentDepth}`,
      "FollowUpNodeService",
    );

    // Check if we've processed all questions at current depth
    if (currentIndex >= state.followUpQuestions.length) {
      // Check if we have additional questions from previous answers and haven't reached max depth
      const additionalQuestions = this.collectAdditionalQuestions(state.followUpAnswers);

      if (additionalQuestions.length > 0 && currentDepth + 1 < state.maxDepth) {
        // Move to next depth level with additional questions
        return {
          hops: 1,
          followUpQuestions: additionalQuestions.slice(0, this.maxQuestionsPerStep),
          currentFollowUpIndex: 0,
          currentDepth: currentDepth + 1,
          nextStep: "followup",
        };
      }

      // No more questions to process
      return {
        hops: 1,
        nextStep: "synthesis",
      };
    }

    // Process current follow-up question
    const currentQuestion = state.followUpQuestions[currentIndex];
    const communityDetails = await this.gatherCommunityDetails(state.matchedCommunities.map((c) => c.id));

    const inputParams: z.infer<typeof inputSchema> = {
      originalQuestion: state.question,
      followUpQuestion: currentQuestion,
      priorContext: state.priorContext,
      communityDetails,
    };

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema: inputSchema,
      inputParams: inputParams,
      outputSchema: outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.3,
      // Billed to the CALLING agent: its ledger category, its entity. Spread
      // LAST so nothing above can overwrite the attribution.
      ...buildInheritedAttribution(state),
    });

    // Create the follow-up answer record
    const followUpAnswer: FollowUpAnswer = {
      question: currentQuestion,
      answer: llmResponse.answer,
      depth: currentDepth,
      additionalQuestions: llmResponse.additionalQuestions,
      shouldContinue: llmResponse.shouldContinue,
    };

    // Update prior context with this answer
    const updatedPriorContext = `${state.priorContext}\n\nQ: ${currentQuestion}\nA: ${llmResponse.answer}`;

    this.logger.debug(
      `FollowUp Node complete: answered question, ${llmResponse.additionalQuestions.length} additional questions`,
      "FollowUpNodeService",
    );

    return {
      hops: 1,
      followUpAnswers: [followUpAnswer],
      priorContext: updatedPriorContext,
      currentFollowUpIndex: currentIndex + 1,
      tokens: llmResponse.tokenUsage,
      nextStep: "followup", // Continue processing follow-ups
    };
  }

  /**
   * Collect additional questions from follow-up answers that should continue
   */
  private collectAdditionalQuestions(followUpAnswers: FollowUpAnswer[]): string[] {
    const questions: string[] = [];
    for (const answer of followUpAnswers) {
      if (answer.shouldContinue && answer.additionalQuestions.length > 0) {
        questions.push(...answer.additionalQuestions);
      }
    }
    return questions;
  }

  /**
   * Gather detailed information about communities for local search
   */
  private async gatherCommunityDetails(communityIds: string[]): Promise<string> {
    const details: string[] = [];

    for (const communityId of communityIds.slice(0, 3)) {
      try {
        const community = await this.communityRepository.findById(communityId);
        if (!community) continue;

        const members = await this.communityRepository.findMemberKeyConcepts(communityId);
        const relationships = await this.communityRepository.findMemberRelationships(communityId);

        const memberDetails = members
          .map((m) => {
            const desc = m.description ? ` - ${m.description}` : "";
            return `  - ${m.value}${desc}`;
          })
          .join("\n");

        const relationshipDetails =
          relationships.length > 0
            ? relationships.map((r) => `  - ${r.keyConcept1} <-> ${r.keyConcept2}`).join("\n")
            : "  (no explicit relationships)";

        details.push(`## ${community.name}\n\nMembers:\n${memberDetails}\n\nRelationships:\n${relationshipDetails}`);
      } catch (error) {
        this.logger.warn(`Failed to gather details for community ${communityId}: ${(error as Error).message}`);
      }
    }

    return details.join("\n\n---\n\n");
  }
}
