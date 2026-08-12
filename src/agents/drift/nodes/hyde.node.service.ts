import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { EmbedderService } from "../../../core";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { DriftContext, DriftContextState } from "../contexts/drift.context";
import { buildInheritedAttribution, buildInheritedEmbedderAttribution } from "../../common/usage-attribution";

export const defaultHydePrompt = `
You are a knowledge synthesis expert. Given a question, generate a hypothetical answer
that would appear in a community summary report.

## Context

Community summaries are narrative reports that describe clusters of related entities
from a knowledge graph. They typically:
- Identify the main theme or domain
- Describe key entities and their roles
- Explain relationships between entities
- Provide contextual information

## Your Task

Generate a hypothetical answer to the question as if it were extracted from a
community summary report. The answer should:
- Be written in the same style as a community report
- Include relevant entity names and relationships
- Provide context and explanation
- Be comprehensive but concise (100-200 words)

## Important

Do NOT try to answer the question factually. Generate a HYPOTHETICAL answer
that captures the TYPE of information that would answer this question.
`;

const outputSchema = z.object({
  hypotheticalAnswer: z
    .string()
    .describe("A hypothetical answer written in the style of a community summary report (100-200 words)"),
});

const inputSchema = z.object({
  question: z.string().describe("The user's question to generate a hypothetical answer for"),
  sampleSummary: z.string().optional().describe("An optional sample community summary for style reference"),
});

@Injectable()
export class HydeNodeService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly embedderService: EmbedderService,
    private readonly communityRepository: CommunityRepository,
    private readonly logger: AppLoggingService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.hydeGenerator ?? defaultHydePrompt;
  }

  async execute(params: { state: typeof DriftContext.State }): Promise<Partial<DriftContextState>> {
    this.logger.debug(`HyDE Node: generating hypothetical answer for "${params.state.question}"`, "HydeNodeService");

    // Optionally fetch a sample community summary for style reference
    let sampleSummary: string | undefined;
    try {
      const communities = await this.communityRepository.findByLevel({ level: 1 });
      if (communities.length > 0 && communities[0].summary) {
        sampleSummary = communities[0].summary;
      }
    } catch {
      // Ignore - sample is optional
    }

    // Generate hypothetical answer via LLM
    const inputParams: z.infer<typeof inputSchema> = {
      question: params.state.question,
      sampleSummary,
    };

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema: inputSchema,
      inputParams: inputParams,
      outputSchema: outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.5,
      // Billed to the CALLING agent: its ledger category, its entity. Spread
      // LAST so nothing above can overwrite the attribution.
      ...buildInheritedAttribution(params.state),
    });

    // Generate embedding for the hypothetical answer. Task 8 left this site
    // unattributed because the DRIFT state held nothing to bill it to; it now
    // carries the caller's, so the embedding lands on the same entity as the
    // LLM call above. Absent attribution => `undefined` => nothing recorded.
    const embedding = await this.embedderService.vectoriseText({
      text: llmResponse.hypotheticalAnswer,
      attribution: buildInheritedEmbedderAttribution(params.state),
    });

    this.logger.debug(
      `HyDE Node complete: generated ${llmResponse.hypotheticalAnswer.length} char answer`,
      "HydeNodeService",
    );

    return {
      hops: 1,
      hypotheticalAnswer: llmResponse.hypotheticalAnswer,
      hydeEmbedding: embedding,
      tokens: llmResponse.tokenUsage,
      nextStep: "community_search",
    };
  }
}
