import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { UsageMetadata } from "../../../common/interfaces/langchain.usage.interface";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { ModelService } from "../../../core/llm/services/model.service";
import { Chunk } from "../../../foundations/chunk/entities/chunk.entity";
import { SUMMARISER_COMBINE_PROMPT, SUMMARISER_MAP_PROMPT, SUMMARISER_TLDR_PROMPT } from "../../prompts/prompt.tokens";

export const defaultMapPrompt = `Summarize the following content in Italian using clean markdown formatting.

IMPORTANT: Output ONLY the summary content directly. Do NOT include:
- Introductory phrases like "Here is a summary"
- Meta-commentary about what you're doing
- Unnecessary horizontal rules or separators

Just write the summary content itself.

{context}`;

export const defaultCombinePrompt = `Based on the following summaries, write a consolidated summary in Italian that integrates all the main themes and key points.

{text}

IMPORTANT: Output ONLY the summary content directly. Do NOT include:
- Introductory phrases like "Here is a summary"
- Meta-commentary about what you're doing
- Unnecessary horizontal rules or separators
- Any reference to the fact that you are synthesizing summaries

Write directly about the content subject. Use well-structured markdown with appropriate headings, bullet points, and emphasis.`;

export const defaultTldrPrompt = `Create a single concise sentence (maximum 20 words) that captures the essential point of this summary:

{summary}`;

@Injectable()
export class SummariserService {
  private readonly mapPromptText: string;
  private readonly combinePromptText: string;
  private readonly tldrPromptText: string;

  constructor(
    private readonly modelService: ModelService,
    @Optional() @Inject(SUMMARISER_MAP_PROMPT) customMapPrompt?: string,
    @Optional() @Inject(SUMMARISER_COMBINE_PROMPT) customCombinePrompt?: string,
    @Optional() @Inject(SUMMARISER_TLDR_PROMPT) customTldrPrompt?: string,
  ) {
    this.mapPromptText = customMapPrompt ?? defaultMapPrompt;
    this.combinePromptText = customCombinePrompt ?? defaultCombinePrompt;
    this.tldrPromptText = customTldrPrompt ?? defaultTldrPrompt;
  }

  async summarise(params: { chunks: Chunk[] }): Promise<{
    content: string;
    tldr: string;
    tokens: TokenUsageInterface;
  }> {
    const model = this.modelService.getLLM({});

    const documents: Document[] = params.chunks.map((chunk: Chunk) => ({
      pageContent: chunk.content,
      metadata: { position: chunk.position },
      id: chunk.position.toString(),
    }));

    const mapPrompt = ChatPromptTemplate.fromMessages([["user", this.mapPromptText]]);

    const combinePrompt = ChatPromptTemplate.fromMessages([["user", this.combinePromptText]]);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const mapPromises = documents.map(async (doc) => {
      const prompt = await mapPrompt.invoke({ context: doc.pageContent });
      const response = await model.invoke(prompt);

      const tokens = response.usage_metadata as UsageMetadata;
      return {
        summary: String(response.content),
        inputTokens: tokens?.input_tokens || 0,
        outputTokens: tokens?.output_tokens || 0,
      };
    });

    const mapResults = await Promise.all(mapPromises);

    mapResults.forEach((result) => {
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    });

    const combinedText = mapResults.map((r) => r.summary).join("\n\n");
    const reducePromptFormatted = await combinePrompt.invoke({ text: combinedText });
    const reduceResponse = await model.invoke(reducePromptFormatted);

    const reduceTokens = reduceResponse.usage_metadata as UsageMetadata;

    totalInputTokens += reduceTokens?.input_tokens || 0;
    totalOutputTokens += reduceTokens?.output_tokens || 0;

    const summary = String(reduceResponse.content);

    const tldrPrompt = ChatPromptTemplate.fromMessages([["user", this.tldrPromptText]]);

    const tldrFormatted = await tldrPrompt.invoke({ summary });
    const tldrResponse = await model.invoke(tldrFormatted);

    const tldrTokens = tldrResponse.usage_metadata as UsageMetadata;

    totalInputTokens += tldrTokens?.input_tokens || 0;
    totalOutputTokens += tldrTokens?.output_tokens || 0;

    return {
      content: summary,
      tldr: String(tldrResponse.content),
      tokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
    };
  }
}
