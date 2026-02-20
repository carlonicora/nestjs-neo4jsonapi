import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Injectable } from "@nestjs/common";
import * as math from "mathjs";
import * as natural from "natural";
import { ModelService } from "../../../../core/llm/services/model.service";
import TurndownService from "turndown";
import { TextLoader } from "../../loaders/text.loader";
const pdf = require("pdf-parse");
const fs = require("fs");

interface SentenceObject {
  sentence: string;
  index: number;
  combined_sentence?: string;
  combined_sentence_embedding?: number[];
  distance_to_next?: number;
}

const _ = require("lodash");

@Injectable()
export class SemanticSplitterService {
  constructor(private readonly modelService: ModelService) {}

  private async loadTextFile(relativePath: string): Promise<string> {
    const loader = new TextLoader(relativePath);
    const docs = await loader.load();
    const textCorpus = docs[0].pageContent;
    return textCorpus;
  }

  private async loadHtmlFile(relativePath: string): Promise<string> {
    if (!fs.existsSync(relativePath)) {
      throw new Error(`File not found: ${relativePath}`);
    }
    return fs.readFileSync(relativePath, "utf-8");
  }

  private normalizeContent(content: string): string {
    return content
      .replace(/\s+/g, " ") // Collapse all whitespace into single spaces
      .trim(); // Remove leading and trailing whitespace
  }

  private async splitHtmlContent(htmlContent: string): Promise<string[]> {
    const splitter = RecursiveCharacterTextSplitter.fromLanguage("html", {
      chunkSize: 1000,
      chunkOverlap: 500,
    });

    const parts = await splitter.createDocuments([htmlContent]);

    const turndownService = new TurndownService();

    const chunks = parts.map((part) => {
      return turndownService.turndown(this.normalizeContent(part.pageContent));
    });

    return chunks;
  }

  private async loadDocxFile(relativePath: string): Promise<string> {
    const loader = new DocxLoader(relativePath);
    const docs = await (loader as any).load();

    const textCorpus = docs[0].pageContent;
    return textCorpus;
  }

  private async loadPdfFile(relativePath) {
    const pdfBuffer = fs.readFileSync(relativePath);
    const pdfData = await pdf(pdfBuffer);
    return pdfData.text;
  }

  private splitToSentencesUsingNLP(textCorpus: string): string[] {
    const tokenizer = new natural.SentenceTokenizer([]);
    const sentences = tokenizer.tokenize(textCorpus);
    return sentences;
  }

  quantile(arr, q) {
    if (!arr || arr.length === 0) return undefined;
    if (q < 0 || q > 1) return undefined;

    const sorted = _.sortBy(arr);

    // Handle single element case
    if (sorted.length === 1) return sorted[0];

    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;

    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
      return sorted[base];
    }
  }

  private async splitToSentences(textCorpus: string): Promise<string[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 200,
      chunkOverlap: 20,
    });

    const output = await splitter.createDocuments([textCorpus]);

    return output.map((out) => out.pageContent);
  }

  private structureSentences(sentences: string[], bufferSize: number = 1): SentenceObject[] {
    const sentenceObjectArray: SentenceObject[] = sentences.map((sentence, i) => ({
      sentence,
      index: i,
    }));

    sentenceObjectArray.forEach((currentSentenceObject, i) => {
      let combinedSentence = "";

      for (let j = i - bufferSize; j < i; j++) {
        if (j >= 0) {
          combinedSentence += sentenceObjectArray[j].sentence + " ";
        }
      }

      combinedSentence += currentSentenceObject.sentence + " ";

      for (let j = i + 1; j <= i + bufferSize; j++) {
        if (j < sentenceObjectArray.length) {
          combinedSentence += sentenceObjectArray[j].sentence;
        }
      }

      sentenceObjectArray[i].combined_sentence = combinedSentence.trim();
    });

    return sentenceObjectArray;
  }

  private async generateAndAttachEmbeddings(sentencesArray: SentenceObject[]): Promise<SentenceObject[]> {
    try {
      /* Create embedding instance */
      const embeddings = this.modelService.getEmbedder();

      // Deep copy the sentencesArray to ensure purity
      const sentencesArrayCopy: SentenceObject[] = sentencesArray.map((sentenceObject) => ({
        ...sentenceObject,
        combined_sentence_embedding: sentenceObject.combined_sentence_embedding
          ? [...sentenceObject.combined_sentence_embedding]
          : undefined,
      }));

      // Extract combined sentences for embedding
      const combinedSentencesStrings: string[] = sentencesArrayCopy
        .filter((item) => item.combined_sentence !== undefined)
        .map((item) => item.combined_sentence as string);

      // Handle case where no sentences to embed
      if (combinedSentencesStrings.length === 0) {
        console.warn("No sentences found for embedding generation");
        return sentencesArrayCopy;
      }

      // Generate embeddings for the combined sentences
      const embeddingsArray = await embeddings.embedDocuments(combinedSentencesStrings);

      // Attach embeddings to the corresponding SentenceObject in the copied array
      let embeddingIndex = 0;
      for (let i = 0; i < sentencesArrayCopy.length; i++) {
        if (sentencesArrayCopy[i].combined_sentence !== undefined) {
          if (embeddingIndex < embeddingsArray.length) {
            sentencesArrayCopy[i].combined_sentence_embedding = embeddingsArray[embeddingIndex++];
          } else {
            console.warn(`Missing embedding for sentence at index ${i}`);
          }
        }
      }

      return sentencesArrayCopy;
    } catch (error) {
      console.error("Error generating embeddings, returning sentences without embeddings:", error);
      // Return the original sentences without embeddings rather than failing completely
      return sentencesArray.map((sentenceObject) => ({
        ...sentenceObject,
        combined_sentence_embedding: undefined,
      }));
    }
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    try {
      // Handle empty or invalid vectors
      if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
        console.warn("Invalid vectors for cosine similarity calculation");
        return 0;
      }

      const dotProduct = math.dot(vecA, vecB) as number;

      const normA = math.norm(vecA) as number;
      const normB = math.norm(vecB) as number;

      if (normA === 0 || normB === 0 || !isFinite(normA) || !isFinite(normB)) {
        return 0;
      }

      const similarity = dotProduct / (normA * normB);

      // Handle NaN or infinite results
      if (!isFinite(similarity)) {
        console.warn("Non-finite cosine similarity result, returning 0");
        return 0;
      }

      return similarity;
    } catch (error) {
      console.error("Error calculating cosine similarity:", error);
      return 0;
    }
  }

  private async calculateCosineDistancesAndSignificantShifts(
    sentenceObjectArray: SentenceObject[],
    percentileThreshold: number,
  ): Promise<{
    updatedArray: SentenceObject[];
    significantShiftIndices: number[];
  }> {
    // Calculate cosine distances and update the array
    const distances: number[] = [];
    const updatedSentenceObjectArray = sentenceObjectArray.map((item, index, array) => {
      if (
        index < array.length - 1 &&
        item.combined_sentence_embedding &&
        array[index + 1].combined_sentence_embedding
      ) {
        const embeddingCurrent = item.combined_sentence_embedding!;
        const embeddingNext = array[index + 1].combined_sentence_embedding!;
        const similarity = this.cosineSimilarity(embeddingCurrent, embeddingNext);
        const distance = 1 - similarity;
        distances.push(distance); // Keep track of calculated distances
        return { ...item, distance_to_next: distance };
      } else {
        return { ...item, distance_to_next: undefined };
      }
    });

    // Handle case where no distances were calculated (empty array, single sentence, etc.)
    if (distances.length === 0) {
      return {
        updatedArray: updatedSentenceObjectArray,
        significantShiftIndices: [], // No shifts when no distances
      };
    }

    // Determine the threshold value for significant shifts
    const sortedDistances = [...distances].sort((a, b) => a - b);
    const quantileThreshold = percentileThreshold / 100;

    // const breakpointDistanceThreshold = d3Array.quantile(
    //   sortedDistances,
    //   quantileThreshold,
    // );

    const breakpointDistanceThreshold = this.quantile(sortedDistances, quantileThreshold);

    if (breakpointDistanceThreshold === undefined) {
      // Fallback: use the median distance if quantile calculation fails
      const medianIndex = Math.floor(sortedDistances.length / 2);
      const fallbackThreshold = sortedDistances[medianIndex] || 0.5; // Default to 0.5 if still undefined

      const significantShiftIndices = distances
        .map((distance, index) => (distance > fallbackThreshold ? index : -1))
        .filter((index) => index !== -1);

      return {
        updatedArray: updatedSentenceObjectArray,
        significantShiftIndices,
      };
    }

    // Identify indices of significant shifts
    const significantShiftIndices = distances
      .map((distance, index) => (distance > breakpointDistanceThreshold ? index : -1))
      .filter((index) => index !== -1);

    return {
      updatedArray: updatedSentenceObjectArray,
      significantShiftIndices,
    };
  }

  private groupSentencesIntoChunks(sentenceObjectArray: SentenceObject[], shiftIndices: number[]): string[] {
    // Handle empty array case
    if (!sentenceObjectArray || sentenceObjectArray.length === 0) {
      return [];
    }

    let startIdx = 0; // Initialize the start index
    const chunks: string[] = []; // Create an array to hold the grouped sentences

    // Handle case where there are no shift indices
    if (!shiftIndices || shiftIndices.length === 0) {
      const combinedText = sentenceObjectArray.map((item) => item.sentence).join(" ");
      return combinedText.trim() ? [combinedText] : [];
    }

    // Add one beyond the last index to handle remaining sentences as a final chunk
    const adjustedBreakpoints = [...shiftIndices, sentenceObjectArray.length - 1];

    // Iterate through the breakpoints to slice and accumulate sentences into chunks
    adjustedBreakpoints.forEach((breakpoint) => {
      // Extract the sentences from the current start index to the breakpoint (inclusive)
      const group = sentenceObjectArray.slice(startIdx, breakpoint + 1);
      const combinedText = group.map((item) => item.sentence).join(" "); // Combine the sentences
      if (combinedText.trim()) {
        // Only add non-empty chunks
        chunks.push(combinedText);
      }

      startIdx = breakpoint + 1; // Update the start index for the next group
    });

    return chunks;
  }

  /**
   * Merges small adjacent chunks while preserving semantic coherence.
   * Ensures chunks meet minimum size requirements by merging semantically similar neighbors.
   */
  private async mergeSmallChunks(chunks: string[], minChunkSize: number = 1000): Promise<string[]> {
    if (!chunks || chunks.length <= 1) {
      return chunks;
    }

    try {
      // Generate embeddings for all chunks in a single batch call
      const embeddings = this.modelService.getEmbedder();
      const chunkEmbeddings = await embeddings.embedDocuments(chunks);

      let mergedChunks = [...chunks];
      let mergedEmbeddings = [...chunkEmbeddings];
      let hasChanges = true;

      // Keep merging until no more small chunks can be merged
      while (hasChanges) {
        hasChanges = false;
        const newChunks: string[] = [];
        const newEmbeddings: number[][] = [];
        // Track which indices in newChunks need re-embedding (were merged)
        const needsReembedding: number[] = [];
        let i = 0;

        while (i < mergedChunks.length) {
          const currentChunk = mergedChunks[i];
          const currentEmbedding = mergedEmbeddings[i];

          // If chunk is large enough or it's the last chunk, keep it as-is
          if (currentChunk.length >= minChunkSize || i === mergedChunks.length - 1) {
            newChunks.push(currentChunk);
            newEmbeddings.push(currentEmbedding);
            i++;
            continue;
          }

          // Chunk is too small - check if we can merge with next chunk
          if (i < mergedChunks.length - 1) {
            const nextChunk = mergedChunks[i + 1];
            const nextEmbedding = mergedEmbeddings[i + 1];

            // Calculate semantic similarity with next chunk
            const similarity = this.cosineSimilarity(currentEmbedding, nextEmbedding);

            // Merge if similarity is high enough (>0.7 indicates strong semantic relation)
            // or if the combined size is reasonable (<3000 chars)
            const combinedSize = currentChunk.length + nextChunk.length;
            if (similarity > 0.7 || combinedSize < 2000) {
              const mergedChunk = `${currentChunk} ${nextChunk}`;
              needsReembedding.push(newChunks.length); // Track index for batch re-embedding
              newChunks.push(mergedChunk);
              newEmbeddings.push([]); // Placeholder, will be filled by batch call

              hasChanges = true;
              i += 2; // Skip the next chunk since we merged it
            } else {
              // Can't merge, keep current chunk despite being small
              newChunks.push(currentChunk);
              newEmbeddings.push(currentEmbedding);
              i++;
            }
          } else {
            // Last chunk and it's small - keep it
            newChunks.push(currentChunk);
            newEmbeddings.push(currentEmbedding);
            i++;
          }
        }

        // Batch re-embed all merged chunks in a single API call
        if (needsReembedding.length > 0) {
          const textsToEmbed = needsReembedding.map((idx) => newChunks[idx]);
          const batchEmbeddings = await embeddings.embedDocuments(textsToEmbed);
          for (let j = 0; j < needsReembedding.length; j++) {
            newEmbeddings[needsReembedding[j]] = batchEmbeddings[j];
          }
        }

        mergedChunks = newChunks;
        mergedEmbeddings = newEmbeddings;
      }

      return mergedChunks;
    } catch (error) {
      console.error("Error merging small chunks, returning original chunks:", error);
      return chunks;
    }
  }

  private async splitContentSemanticially(content: string, metadata?: any): Promise<Document[]> {
    if (!content || content.trim().length === 0) {
      return [new Document({ pageContent: content || "", metadata })];
    }

    const sentences = await this.splitToSentences(content);

    if (!sentences || sentences.length === 0) {
      return [new Document({ pageContent: content, metadata })];
    }

    try {
      const structuredSentences = this.structureSentences(sentences, 3);
      const sentencesWithEmbeddings = await this.generateAndAttachEmbeddings(structuredSentences);

      const { updatedArray, significantShiftIndices } = await this.calculateCosineDistancesAndSignificantShifts(
        sentencesWithEmbeddings,
        75,
      );

      const chunks = this.groupSentencesIntoChunks(updatedArray, significantShiftIndices);

      if (chunks.length === 0) {
        return [new Document({ pageContent: content, metadata })];
      }

      // Merge small chunks while preserving semantic coherence
      const mergedChunks = await this.mergeSmallChunks(chunks, 1000);

      return mergedChunks.map((chunk: string) => {
        return new Document({
          pageContent: chunk,
          metadata: { ...metadata, type: "semantic_chunk" },
        });
      });
    } catch (error) {
      console.error("Error in semantic splitting, falling back to content as-is:", error);
      return [new Document({ pageContent: content, metadata })];
    }
  }

  async splitDocumentToChunks(params: { document: Document }): Promise<Document[]> {
    return this.splitContentSemanticially(params.document.pageContent, { type: "paragraphs" });
  }

  async splitMarkdownToChunks(params: { content: string; title?: string }): Promise<Document[]> {
    if (!params.content || params.content.trim().length === 0) {
      return [new Document({ pageContent: params.content || "" })];
    }

    try {
      const fullContent = params.title ? `# ${params.title}\n\n${params.content}` : params.content;

      const structuredSections = this.splitMarkdownByStructure(fullContent);

      // If no structure found (no headers), use semantic splitting on entire content
      if (structuredSections.length <= 1) {
        if (fullContent.length <= 1500) {
          return [
            new Document({
              pageContent: fullContent,
              metadata: { type: "markdown_section", split_method: "single_chunk" },
            }),
          ];
        } else {
          // Apply semantic splitting to the entire content
          return await this.splitContentSemanticially(fullContent, {
            type: "markdown_section",
            split_method: "semantic_full",
          });
        }
      }

      // Process all sections in parallel for better performance
      const sectionResults = await Promise.all(
        structuredSections.map(async (section, i) => {
          const trimmedSection = section.trim();

          if (trimmedSection.length < 50) {
            return [];
          }

          // Extract header from section for metadata
          const headerMatch = trimmedSection.match(/^(#+)\s+(.+)/);
          const headerLevel = headerMatch ? headerMatch[1].length : 0;
          const headerText = headerMatch ? headerMatch[2] : "";

          if (this.isTableSection(trimmedSection)) {
            return [
              new Document({
                pageContent: trimmedSection,
                metadata: {
                  type: "table_section",
                  split_method: "table",
                  section_index: i,
                  header_level: headerLevel,
                  header_text: headerText,
                },
              }),
            ];
          }

          // Apply hybrid logic: use semantic splitting for sections > 1500 chars
          if (trimmedSection.length > 1500) {
            try {
              return await this.splitContentSemanticially(trimmedSection, {
                type: "markdown_section",
                split_method: "semantic_section",
                section_index: i,
                header_level: headerLevel,
                header_text: headerText,
              });
            } catch (error) {
              console.warn(`Semantic splitting failed for section ${i}, falling back to basic splitting:`, error);

              // Fallback to basic splitting
              const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 2000,
                chunkOverlap: 200,
                separators: ["\n\n", "\n", ". ", " "],
              });

              const sectionChunks = await splitter.createDocuments([trimmedSection]);
              sectionChunks.forEach((chunk, chunkIndex) => {
                chunk.metadata = {
                  type: "markdown_section",
                  split_method: "basic_fallback",
                  section_index: i,
                  chunk_index: chunkIndex,
                  header_level: headerLevel,
                  header_text: headerText,
                };
              });
              return sectionChunks;
            }
          }

          // Keep smaller sections as single coherent chunks
          return [
            new Document({
              pageContent: trimmedSection,
              metadata: {
                type: "markdown_section",
                split_method: "header_section",
                section_index: i,
                header_level: headerLevel,
                header_text: headerText,
              },
            }),
          ];
        }),
      );

      const allChunks = sectionResults.flat();

      // Note: Per-section mergeSmallChunks already runs inside splitContentSemanticially.
      // A second global merge here would re-embed ALL chunks again, doubling API cost.
      // Skipping the redundant final merge to reduce embedding round-trips.

      return allChunks.length > 0 ? allChunks : [new Document({ pageContent: fullContent })];
    } catch (error) {
      console.error("Error splitting markdown to chunks", error);
      return [new Document({ pageContent: params.content })];
    }
  }

  private splitMarkdownByStructure(content: string): string[] {
    const sections: string[] = [];
    const lines = content.split("\n");
    let currentSection = "";

    for (const line of lines) {
      if (line.trim().startsWith("#")) {
        if (currentSection.trim()) sections.push(currentSection.trim());

        currentSection = line + "\n";
      } else {
        currentSection += line + "\n";
      }
    }

    if (currentSection.trim()) sections.push(currentSection.trim());

    return sections.length > 0 ? sections : [content];
  }

  private isTableSection(section: string): boolean {
    const lines = section.trim().split("\n");
    const firstLine = lines[0]?.trim() || "";

    if (!firstLine.startsWith("## ")) {
      return false;
    }

    const contentLines = lines.slice(1).filter((line) => line.trim() !== "");
    return contentLines.length > 0;
  }

  async splitTextToChunks(params: { filePath: string; type: string }): Promise<Document[]> {
    let text: string;
    let semanticChunks: string[];

    try {
      switch (params.type) {
        case "txt":
        case "adoc":
          text = await this.loadTextFile(params.filePath);
          semanticChunks = this.splitToSentencesUsingNLP(text);
          break;
        case "docx":
          text = await this.loadDocxFile(params.filePath);
          semanticChunks = this.splitToSentencesUsingNLP(text);
          break;
        case "pdf":
          text = await this.loadPdfFile(params.filePath);
          semanticChunks = this.splitToSentencesUsingNLP(text);
          break;
        case "html":
          text = await this.loadHtmlFile(params.filePath);
          semanticChunks = await this.splitHtmlContent(text);
          break;
        default:
          console.warn(`Unsupported file type: ${params.type}`);
          return [];
      }

      try {
        const structuredSentences = this.structureSentences(semanticChunks, 1);
        const sentencesWithEmbeddings = await this.generateAndAttachEmbeddings(structuredSentences);

        const { updatedArray, significantShiftIndices } = await this.calculateCosineDistancesAndSignificantShifts(
          sentencesWithEmbeddings,
          95,
        );

        const chunks = this.groupSentencesIntoChunks(updatedArray, significantShiftIndices);

        return chunks.map((chunk: string) => {
          return new Document({
            pageContent: chunk,
            metadata: { type: "paragraphs" },
          });
        });
      } catch (processingError) {
        console.error("Error in semantic processing, falling back to simple chunks:", processingError);
        return semanticChunks.map((chunk: string) => {
          return new Document({
            pageContent: chunk,
            metadata: { type: "simple_chunks" },
          });
        });
      }
    } catch (error) {
      console.error("Error splitting text to chunks:", error);
      return [];
    }
  }
}
