import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { EmbedderService } from "../../../core";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { Community } from "../../../foundations/community/entities/community.entity";
import { communityMeta } from "../../../foundations/community/entities/community.meta";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { TokenUsageType } from "../../../foundations/tokenusage/enums/tokenusage.type";

export const prompt = `
You are an expert knowledge analyst tasked with summarizing a community of related entities from a knowledge graph.

## Your Task

Given a cluster of entities (key concepts) and their relationships, create a comprehensive summary that:

1. **Identifies the Main Theme**: What is the central topic or domain this cluster represents?
2. **Describes Key Entities**: Explain the most important entities and their roles within this cluster
3. **Explains Relationships**: Describe how the entities are connected and interact
4. **Provides Context**: Give context for why these entities are grouped together

## Guidelines

- Write in clear, professional prose
- Focus on the most significant entities and relationships
- Provide actionable insights where possible
- Keep the summary between 200-500 words
- Use the entity descriptions when available to enrich your summary

## Output Format

Provide:
- **title**: A concise, descriptive title for this community (max 50 characters)
- **summary**: A narrative summary following the guidelines above
- **rating**: A quality score from 0-100 based on:
  - Coherence: How well do the entities relate to each other?
  - Completeness: Does the cluster represent a meaningful concept?
  - Usefulness: How valuable is this cluster for understanding the domain?
`;

const outputSchema = z.object({
  title: z.string().describe("A concise, descriptive title for this community (max 50 characters)"),
  summary: z.string().describe("A narrative summary of the community (200-500 words)"),
  rating: z
    .number()
    .min(0)
    .max(100)
    .describe("Quality score from 0-100 based on coherence, completeness, and usefulness"),
});

const inputSchema = z.object({
  entities: z.string().describe("List of entities in the community with their descriptions"),
  relationships: z.string().describe("List of relationships between entities"),
  level: z.number().describe("Hierarchy level of the community (0 = most granular)"),
  memberCount: z.number().describe("Number of entities in this community"),
});

@Injectable()
export class CommunitySummariserService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly embedderService: EmbedderService,
    private readonly communityRepository: CommunityRepository,
    private readonly logger: AppLoggingService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.communitySummariser ?? prompt;
  }

  /**
   * Find a community by ID and generate its summary
   */
  async generateSummaryById(communityId: string): Promise<void> {
    const community = await this.communityRepository.findById(communityId);
    if (!community) {
      this.logger.warn(`Community ${communityId} not found, skipping`, "CommunitySummariserService");
      return;
    }
    await this.generateSummary(community);
  }

  /**
   * Generate summary for a single community
   */
  async generateSummary(community: Community): Promise<void> {
    this.logger.debug(
      `Generating summary for community ${community.id} (level: ${community.level})`,
      "CommunitySummariserService",
    );

    // Fetch member KeyConcepts with descriptions
    const members = await this.communityRepository.findMemberKeyConcepts(community.id);

    if (members.length === 0) {
      this.logger.warn(`Community ${community.id} has no members, skipping`, "CommunitySummariserService");
      return;
    }

    // Fetch relationships between members
    const relationships = await this.communityRepository.findMemberRelationships(community.id);

    // Format entities for LLM
    const entitiesText = members
      .map((m) => {
        const desc = m.description ? `: ${m.description}` : "";
        return `- ${m.value}${desc}`;
      })
      .join("\n");

    // Format relationships for LLM
    const relationshipsText =
      relationships.length > 0
        ? relationships.map((r) => `- ${r.keyConcept1} <-> ${r.keyConcept2} (weight: ${r.weight})`).join("\n")
        : "No explicit relationships between members.";

    // Call LLM to generate summary
    const inputParams: z.infer<typeof inputSchema> = {
      entities: entitiesText,
      relationships: relationshipsText,
      level: community.level,
      memberCount: members.length,
    };

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema,
      inputParams,
      outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.3,
      tokenUsageType: TokenUsageType.CommunitySummariser,
      relationshipId: community.id,
      relationshipType: communityMeta.labelName,
    });

    // Generate embedding for the summary. Same ledger category as the call above so one
    // community's summary reads as one cost; billed against the community itself — this
    // agent is cron-driven with no calling agent to inherit attribution from.
    const embedding = await this.embedderService.vectoriseText({
      text: `${llmResponse.title}\n\n${llmResponse.summary}`,
      attribution: {
        relationshipId: community.id,
        relationshipType: communityMeta.labelName,
        tokenUsageType: TokenUsageType.CommunitySummariser,
      },
    });

    // Update the community with summary and embedding
    await this.communityRepository.updateSummary({
      communityId: community.id,
      name: llmResponse.title.substring(0, 50),
      summary: llmResponse.summary,
      embedding,
      rating: Math.round(llmResponse.rating),
    });

    this.logger.debug(
      `Generated summary for community ${community.id}: "${llmResponse.title}" (rating: ${llmResponse.rating})`,
      "CommunitySummariserService",
    );
  }
}
