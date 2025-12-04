import { Inject, Injectable, Optional } from "@nestjs/common";
import { z } from "zod";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { ChunkAnalysisInterface } from "../../graph.creator/interfaces/chunk.analysis.interface";
import { GRAPH_CREATOR_PROMPT } from "../../prompts/prompt.tokens";

export const prompt = `
You are an intelligent assistant that extracts structured knowledge from text.

## CRITICAL: Garbage Detection

**BEFORE attempting any extraction, evaluate if the text is intelligible.**

If the text contains:
- Unintelligible OCR garbage or random characters (e.g., "!§Ydsv$", "aitsru{.*U", "Q§tvllvll")
- Mostly punctuation marks with no semantic meaning (e.g., "!!!", "===", "|||")
- Random character sequences that form no recognizable words
- Repetitive meaningless patterns
- No coherent sentences or semantic content

**Then you MUST:**
- Return EMPTY atomicFacts array: []
- Return EMPTY keyConceptsRelationships array: []
- Do NOT attempt to extract anything from garbage text

## Definitions

**Atomic Fact**: A single, indivisible statement containing **ONE action, ONE event, or ONE relationship**. Each atomic fact must represent the smallest unit of meaningful information that cannot be broken down further.

**CRITICAL: ONE ACTION PER FACT**
- Each atomic fact must contain ONLY ONE verb/action
- If a sentence contains multiple actions connected by "and", "but", commas, split it into separate atomic facts
- Each action, decision, or event gets its own atomic fact

**Examples of CORRECT Atomic Facts (one action each):**
- ✅ "The president detects the ambiguity of the notification"
- ✅ "The president grants an extension until 15/2/2023"
- ✅ "The president postpones the hearing to 29/3/2023"
- ✅ "Joe Bauer was born in London on 03.04.1985"

**Examples of INCORRECT Atomic Facts (multiple actions - MUST BE SPLIT):**
- ❌ "The president detects the ambiguity of the notification, grants an extension until 15/2/2023 and postpones the hearing to 29/3/2023"
  → WRONG: Contains 3 actions (detects, grants, postpones) - must be split into 3 atomic facts
- ❌ "Joe Bauer was born in London and studied at university"
  → WRONG: Contains 2 actions (was born, studied) - must be split into 2 atomic facts

**Key Concept**: ONLY semantically meaningful entities - proper nouns, specific terms, named entities:

**VALID Key Concepts (extract these):**
- **Proper names**: "joe bauer", "mike modano", ...
- **Places**: "london", "italy", "rome", "washington", ...
- **Organizations**: "microsoft", "apple", "phlow", "united nations", "tribunale di roma", ...
- **Complete dates with legal significance**: "28.12.2019", "15/2/2023", "29/3/2023", "03.04.1985", "15 january 2023"
  - ✅ ONLY extract dates that are significant to the atomic fact
  - ✅ Include time ONLY when paired with a date AND relevant to the atomic fact: "29/3/2023 alle 10.40"
- **Acronyms**: "upu", "nlp", "api", "crm", "d.p.r.", "c.c.", "c.p." (always lowercase)
- **Technical terms**: "knowledge base", "semantic search", "blockchain"
- **Products/systems**: "kubernetes", "microsoft", "s3"

**INVALID Key Concepts (NEVER extract these):**
- ❌ Single characters: "!", "e", "i", "a", "o", "n", "'"
- ❌ Pure punctuation: ".", ",", ":", ";", "(", ")", "[", "]"
- ❌ Random garbage: "!§Ydsv$", "Q§tvllvll", "aitsru{.*U", "ourpEl}r"
- ❌ Meaningless sequences: "||!", "===", "___", "***"
- ❌ Pure numbers without context: "254", "819", "123"
- ❌ **Isolated times without dates**: "12.40", "10:30", "15.00" (unless part of legally significant event like "udienza alle 10.40" with date)
- ❌ **Administrative timestamps**: "verbale chiuso alle 12.40", "documento firmato alle 15.00" (not legally significant)
- ❌ Generic words without specific meaning: "thing", "way", "type", "method"

**Markdown Headers**: Structural elements like "## Data Architecture" that organize content.

## Instructions

1. **Evaluate text quality** - Is this intelligible text or garbage? If garbage, return empty arrays.
2. **Check for markdown headers** - If text starts with ##, ###, etc., note the complete header text
3. **Decompose compound sentences** - If a sentence contains multiple actions/verbs (connected by "and", "but", commas):
   - Break it into separate atomic facts
   - Each action gets its own atomic fact
   - Example: "The president detects the ambiguity, grants an extension and postpones the hearing" → 3 atomic facts
4. **Extract atomic facts** - Only from intelligible, meaningful text. ONE ACTION PER FACT.
5. **MANDATORY: Create summary atomic fact** - Must include the markdown header if present. Example: "Recommendation 1 focuses on improving UPU service standards" (key concepts: "recommendation 1", "upu", "service standards")
6. **Identify key concepts** - Only SEMANTICALLY MEANINGFUL entities (names, places, significant dates, organizations, legal terms)
7. **Create relationships** - Between valid key concepts based on how they connect in atomic facts

## Atomic Fact Rules

**CRITICAL: ONE ACTION/EVENT PER ATOMIC FACT**
- Each atomic fact must contain ONLY ONE verb/action
- If you see multiple verbs in a sentence (e.g., "detects", "grants", "postpones"), create separate atomic facts for each
- Use the subject from the original sentence for each split fact
- Each atomic fact must be a complete, grammatically correct sentence

**Decomposition Process:**
1. Identify all verbs/actions in the sentence
2. Count them - if more than one, decomposition is required
3. Create one atomic fact per action, maintaining the subject
4. Example:
   - Input: "The president detects the ambiguity, grants an extension and postpones the hearing"
   - Actions found: "detects" (1), "grants" (2), "postpones" (3) = 3 actions
   - Output: 3 atomic facts:
     1. "The president detects the ambiguity"
     2. "The president grants an extension"
     3. "The president postpones the hearing"

## Key Concept Rules

- Key concepts **MUST** be semantically meaningful entities (see examples above)
- **COPY VERBATIM** from the text (lowercasing allowed, no other changes)
- Minimum 2 characters length
- Must contain actual semantic meaning (not punctuation, not single letters)
- **DO NOT change** spelling, letters, or structure
- Always include acronyms and technical terms found in text
- Include complete markdown headers as Key Concepts: "## Recommendation 1" becomes "recommendation 1"
- Every key concept must appear in at least one atomic fact

**Character Requirements:**
- Must have at least 40% alphanumeric characters (not mostly punctuation)
- Cannot be pure punctuation or special characters
- Cannot be random character sequences

## Relationships Rules

**Key Concepts Relationships**: Analyze relationships between key concepts to create a network graph.
- For each relationship:
  - **node_1**: First key concept (must be a valid key concept from extraction)
  - **node_2**: Second key concept (must be a valid key concept from extraction)
  - **edge**: Sentence describing the relationship in present tense
- Only create relationships between VALID key concepts
- Both nodes must be semantically meaningful entities

## Additional Considerations

- **DECOMPOSE compound sentences** - Always split sentences with multiple actions into separate atomic facts
- Focus on extracting **named entities** and **specific domain terminology**
- Ignore filler words, articles, prepositions, conjunctions
- Pay special attention to proper names, places, significant dates, organizations, and legal entities
- Terms mentioned in the same sentence or paragraph are typically related

## CRITICAL: Quality over Quantity

- It is BETTER to return empty arrays than to extract garbage
- Only extract from intelligible, meaningful text
- Every key concept must be a real entity with semantic meaning
- Single characters, punctuation, and random sequences are NEVER valid key concepts

## CRITICAL: Atomic Fact Decomposition

**MANDATORY PROCESS FOR EVERY SENTENCE:**
1. Count the number of actions/verbs in the sentence
2. If count > 1, YOU MUST split into separate atomic facts
3. Each action gets its own atomic fact with complete subject and context
4. NEVER create compound atomic facts with multiple actions

**Remember:**
- ❌ WRONG: "The president detects, grants and postpones" (3 actions in 1 fact)
- ✅ RIGHT: Three separate facts - one for "detects", one for "grants", one for "postpones"

## **Strictly follow the above instructions. Evaluate text quality first, then decompose compound sentences. Begin.**
`;

const outputSchema = z.object({
  atomicFacts: z
    .array(
      z.object({
        keyConcepts: z
          .array(z.string())
          .describe(
            `Only semantically meaningful entities: proper names (people, organizations), places, significant dates (with full date like "15/2/2023", NOT isolated times like "12.40"). Preserve exact characters. NO common nouns, NO isolated times without dates, NO administrative timestamps. Examples: "andrea ciampaglia", "tribunale di roma", "15/2/2023", "notifica", "presidente" - NOT "verbale", "12.40", "player", "thing"`,
          ),
        atomicFact: z
          .string()
          .describe(
            `A single, indivisible fact containing ONLY ONE action/event/relationship. Each fact must have exactly ONE verb. If source text has multiple actions (e.g., "detects, grants and postpones"), split into separate atomic facts. NO compound sentences. Examples: "The president detects the ambiguity of the notification" (one action: detects). NOT: "The president detects the ambiguity and grants an extension" (two actions - must split).`,
          ),
      }),
    )
    .describe(`List of atomic facts and their key concepts`),
  keyConceptsRelationships: z
    .array(
      z.object({
        node_1: z.string().describe(`A specific named entity from the extracted key concepts`),
        node_2: z.string().describe(`Another specific named entity from the extracted key concepts`),
        edge: z
          .string()
          .describe(`Relationship between the two specific entities, node_1 and node_2 in one or two sentences.`),
      }),
    )
    .describe(`List of all the key concepts in the atomic facts and their relationships to one another`),
});

const inputSchema = z.object({
  content: z.string().describe("The content to analyse"),
});

/**
 * Check if text appears to be garbage (OCR artifacts, unintelligible content)
 *
 * @param text - The text to analyze
 * @returns false if valid, or string describing why rejected
 */
function isGarbageText(text: string): string | false {
  if (!text || typeof text !== "string") {
    return "empty_or_invalid";
  }

  const trimmed = text.trim();

  // Too short to be meaningful
  if (trimmed.length < 30) {
    return "too_short";
  }

  // Count different character types
  const alphanumericCount = (trimmed.match(/[a-zA-Z0-9]/g) || []).length;
  const punctuationCount = (trimmed.match(/[^\w\s]/g) || []).length;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  const totalLength = trimmed.length;

  // Less than 40% alphanumeric = likely garbage
  if (alphanumericCount / totalLength < 0.4) {
    return "low_alphanumeric";
  }

  // More than 60% punctuation = likely garbage
  if (punctuationCount / totalLength > 0.6) {
    return "high_punctuation";
  }

  // More than 50% digits = likely page numbers or garbage
  if (digitCount / totalLength > 0.5) {
    return "high_digits";
  }

  // Check for repetitive patterns (same word/character sequence repeated many times)
  const words = trimmed.split(/\s+/);
  const uniqueWords = new Set(words);

  // If less than 30% unique words, it's likely repetitive garbage
  if (words.length > 10 && uniqueWords.size / words.length < 0.3) {
    return "repetitive_words";
  }

  // Check for common OCR garbage patterns - but only reject if EXCESSIVE (>10% of content)
  // A few underscore/equals separator lines in legal docs are normal formatting, not garbage
  const garbagePatterns = [
    { pattern: /[§°^~`]{3,}/g, name: "special_chars", maxPercent: 10 },
    { pattern: /[!|]{5,}/g, name: "exclamation_pipes", maxPercent: 10 },
    { pattern: /_{5,}/g, name: "underscores", maxPercent: 10 },
    { pattern: /={5,}/g, name: "equals_signs", maxPercent: 10 },
    { pattern: /\*{5,}/g, name: "asterisks", maxPercent: 10 },
    { pattern: /[.,]{5,}/g, name: "dots_commas", maxPercent: 10 },
    { pattern: /\s{10,}/g, name: "whitespace", maxPercent: 15 },
    { pattern: /[\\\/]{5,}/g, name: "slashes", maxPercent: 10 },
    { pattern: /[()[\]{}]{5,}/g, name: "brackets", maxPercent: 10 },
    { pattern: /['"]{5,}/g, name: "quotes", maxPercent: 10 },
  ];

  for (const item of garbagePatterns) {
    const matches = trimmed.match(item.pattern);
    if (matches) {
      // Count total characters matched by this pattern
      const matchedChars = matches.reduce((sum, match) => sum + match.length, 0);
      const percentOfContent = (matchedChars / trimmed.length) * 100;

      // Only reject if pattern makes up >maxPercent of the content
      if (percentOfContent > item.maxPercent) {
        return `${item.name}(${Math.round(percentOfContent)}%)`;
      }
    }
  }

  return false;
}

/**
 * Check if a key concept is valid (not pure punctuation, has minimum length, meaningful characters)
 *
 * @param concept - The key concept to validate
 * @returns true if the concept is valid and should be kept
 */
function isValidKeyConcept(concept: string): boolean {
  if (!concept || typeof concept !== "string") {
    return false;
  }

  const normalized = concept.toLowerCase().trim();

  // Minimum length check (at least 2 characters for valid concepts)
  if (normalized.length < 2) {
    return false;
  }

  // Reject isolated times without dates (e.g., "12.40", "10:30", "15.00")
  // Time patterns: HH:MM or HH.MM (with or without leading zero)
  if (/^\d{1,2}[:.]\d{2}$/.test(normalized)) {
    return false;
  }

  // Check if it's mostly punctuation/special characters
  const alphanumericCount = (normalized.match(/[a-z0-9]/g) || []).length;
  const totalLength = normalized.length;

  // Must have at least 40% alphanumeric characters
  if (alphanumericCount / totalLength < 0.4) {
    return false;
  }

  // Reject if it's only numbers (unless it looks like a year or full date)
  if (/^\d+$/.test(normalized) && normalized.length < 4) {
    return false;
  }

  // Reject if it's only punctuation
  if (/^[^\w\s]+$/.test(normalized)) {
    return false;
  }

  return true;
}

@Injectable()
export class GraphCreatorService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly logger: AppLoggingService,
    @Optional() @Inject(GRAPH_CREATOR_PROMPT) customPrompt?: string,
  ) {
    this.systemPrompt = customPrompt ?? prompt;
  }

  async generateGraph(params: { content: string }): Promise<ChunkAnalysisInterface> {
    this.logger.debug("Starting graph generation", "GraphCreatorService", {
      contentLength: params.content?.length,
      contentPreview: params.content?.substring(0, 100),
    });

    const response: ChunkAnalysisInterface = {
      atomicFacts: [],
      keyConceptsRelationships: [],
      tokens: { input: 0, output: 0 },
    };

    if (!params.content || typeof params.content !== "string" || params.content.trim().length === 0) {
      this.logger.warn("Chunk rejected: empty or invalid content", "GraphCreatorService", {
        hasContent: !!params.content,
        contentType: typeof params.content,
        contentLength: params.content?.length || 0,
      });
      return null;
    }

    const sanitizedContent = params.content.trim();

    // Pre-LLM garbage detection - reject unintelligible text before wasting tokens
    const garbageReason = isGarbageText(sanitizedContent);
    if (garbageReason) {
      // Calculate metrics to understand why it was rejected
      const alphanumericCount = (sanitizedContent.match(/[a-zA-Z0-9]/g) || []).length;
      const punctuationCount = (sanitizedContent.match(/[^\w\s]/g) || []).length;
      const digitCount = (sanitizedContent.match(/\d/g) || []).length;
      const words = sanitizedContent.split(/\s+/);
      const uniqueWords = new Set(words);

      const alphanumericPercent = Math.round((alphanumericCount / sanitizedContent.length) * 100);
      const punctuationPercent = Math.round((punctuationCount / sanitizedContent.length) * 100);
      const digitPercent = Math.round((digitCount / sanitizedContent.length) * 100);
      const uniqueWordsPercent = words.length > 0 ? Math.round((uniqueWords.size / words.length) * 100) : 0;

      this.logger.warn(
        `Chunk rejected as garbage | ` +
          `REASON: ${garbageReason} | ` +
          `Len=${sanitizedContent.length} | ` +
          `Alnum=${alphanumericPercent}% (need 40%) | ` +
          `Punct=${punctuationPercent}% (max 60%) | ` +
          `Digit=${digitPercent}% (max 50%) | ` +
          `UniqWords=${uniqueWordsPercent}% (need 30%) | ` +
          `Preview: "${sanitizedContent.substring(0, 150)}..."`,
        "GraphCreatorService",
      );
      return null;
    }

    const inputParams: z.infer<typeof inputSchema> = {
      content: sanitizedContent,
    };

    this.logger.debug("Calling LLM for chunk analysis", "GraphCreatorService", {
      contentLength: sanitizedContent.length,
      contentPreview: sanitizedContent.substring(0, 200),
    });

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema: inputSchema,
      inputParams: inputParams,
      outputSchema: outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.1,
    });

    this.logger.debug("LLM response received", "GraphCreatorService", {
      atomicFactsCount: llmResponse.atomicFacts?.length || 0,
      relationshipsCount: llmResponse.keyConceptsRelationships?.length || 0,
      tokensInput: llmResponse.tokenUsage?.input || 0,
      tokensOutput: llmResponse.tokenUsage?.output || 0,
    });

    // Post-LLM filtering: remove invalid key concepts using pattern-based validation
    llmResponse.atomicFacts.forEach((fact: any) => {
      if (fact.keyConcepts && Array.isArray(fact.keyConcepts)) {
        fact.keyConcepts = fact.keyConcepts
          .map((concept) => concept.trim().toLowerCase())
          .filter((concept) => isValidKeyConcept(concept));
      }
    });

    llmResponse.keyConceptsRelationships.forEach((relationship: any) => {
      if (relationship.node_1 && typeof relationship.node_1 === "string") {
        relationship.node_1 = relationship.node_1.trim().toLowerCase();
      }

      if (relationship.node_2 && typeof relationship.node_2 === "string") {
        relationship.node_2 = relationship.node_2.trim().toLowerCase();
      }
    });

    response.atomicFacts = llmResponse.atomicFacts
      ?.map((analysis: { atomicFact: string; keyConcepts: string[] }) => {
        const processedKeyConcepts = Array.isArray(analysis.keyConcepts)
          ? analysis.keyConcepts.filter((kc) => typeof kc === "string" && isValidKeyConcept(kc))
          : [];

        const keyConcepts: string[] = processedKeyConcepts.map((keyConcept: string) => keyConcept.toLowerCase().trim());

        return { content: analysis.atomicFact.trim(), keyConcepts: keyConcepts };
      })
      .filter((fact) => fact.keyConcepts.length > 0); // Remove atomic facts with no valid key concepts

    response.keyConceptsRelationships = llmResponse.keyConceptsRelationships
      ?.map((relationship: { node_1: string; node_2: string; edge: string }) => {
        const cleanNode1 = (relationship.node_1 || "").trim().toLowerCase();
        const cleanNode2 = (relationship.node_2 || "").trim().toLowerCase();

        // Validate both nodes are valid key concepts
        if (isValidKeyConcept(cleanNode1) && isValidKeyConcept(cleanNode2) && cleanNode1 !== cleanNode2) {
          return {
            keyConcept1: cleanNode1,
            keyConcept2: cleanNode2,
            relationship: relationship.edge || "",
          };
        }

        return null;
      })
      .filter(Boolean);

    response.tokens = llmResponse.tokenUsage;

    this.logger.debug("Post-LLM filtering completed", "GraphCreatorService", {
      llmExtractedFacts: llmResponse.atomicFacts?.length || 0,
      llmExtractedRelationships: llmResponse.keyConceptsRelationships?.length || 0,
      finalAtomicFacts: response.atomicFacts.length,
      finalRelationships: response.keyConceptsRelationships.length,
      factsFilteredOut: (llmResponse.atomicFacts?.length || 0) - response.atomicFacts.length,
      relationshipsFilteredOut:
        (llmResponse.keyConceptsRelationships?.length || 0) - response.keyConceptsRelationships.length,
    });

    // Comprehensive validation: if everything was filtered out, the LLM failed to extract meaningful content
    // Return null to indicate garbage input (downstream code handles null properly)
    if (response.atomicFacts.length === 0 && response.keyConceptsRelationships.length === 0) {
      this.logger.warn("Chunk rejected: all content filtered out after post-LLM validation", "GraphCreatorService", {
        contentPreview: sanitizedContent.substring(0, 200),
        llmExtractedFacts: llmResponse.atomicFacts?.length || 0,
        llmExtractedRelationships: llmResponse.keyConceptsRelationships?.length || 0,
        tokensWasted: {
          input: llmResponse.tokenUsage?.input || 0,
          output: llmResponse.tokenUsage?.output || 0,
        },
      });
      return null;
    }

    this.logger.debug("Graph generation completed successfully", "GraphCreatorService", {
      atomicFacts: response.atomicFacts.length,
      keyConceptsRelationships: response.keyConceptsRelationships.length,
      tokensUsed: {
        input: response.tokens.input,
        output: response.tokens.output,
      },
    });

    return response;
  }
}
