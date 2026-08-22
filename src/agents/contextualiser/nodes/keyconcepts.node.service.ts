import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { z } from "zod";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { LLMService } from "../../../core/llm/services/llm.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { MAX_KEY_CONCEPTS } from "../../../foundations/chunk/repositories/retrieval.constants";
import { KeyConcept } from "../../../foundations/keyconcept/entities/key.concept.entity";
import { KeyConceptRepository } from "../../../foundations/keyconcept/repositories/keyconcept.repository";
import { buildInheritedAttribution, buildRetrievalAttribution } from "../../common/usage-attribution";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";

export const defaultKeyConceptsPrompt = `
As an intelligent assistant, your primary objective is to score a list of key concepts in relation to the user question.

You are given the question, the rational plan, and a list of key elements.
Your must check a list of Key Concepts, with the objective of selecting the most relevant ones to efficiently answer the question.
These initial key concepts are crucial because they are the starting point for searching for relevant information.

Given the **question**, the **rational plan** to answer the question, and the list of **Key Concepts** you have to:
1. for each key concept
  - Read the key concept
  - Return the key concept's **index** — the position number given to it in the input list.
  - Restate its first few words (at most five) as the **label**, so the score that follows is anchored to the concept you actually read.
  - Assess a relevance to the potential answer by assigning a score between 0 and 100. A score of 100 implies a high likelihood of relevance to the answer, whereas a score of 0 suggests minimal relevance.
2. Provide a Status Message
  - Write a **short, friendly message** (maximum 40 characters) about your action.
  - **Avoid technical terms** such as "nodes", "atomic facts", or "key concepts".
  - The status message should make the user understand the action being taken
  - The status message **MUST** contain clear information contextualised to the current question and the gathered information.
  - The status message should be specific to the context and clearly convey the next steps or actions being taken.
  - The status message **MUST NOT** be something unrelated to the text, such as "success", "sufficient information", "insufficient information", "chunk analysed", "chunk processed" or similar generic messages.

### IMPORTANT
  - You should only use Key concepts provided in the list of key elements and refrain from using any other key concepts.
  - You **MUST NOT** create new key concepts, but use ONLY the ones provided.

### **Please strictly follow the above instructions and format. Let's begin.**
`;

const outputSchema = z.object({
  status: z
    .string()
    .describe(
      `Write a short, friendly message (max 40 characters) about your action, avoiding technical terms such as "nodes" or "atomic facts" or "key concepts". Give flavour to the message and avoid repeating the same message.`,
    ),
  keyConcepts: z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .describe(
            "Zero-based position of the concept in the keyConcepts list you were given. This is the ONLY field used to identify the concept — copy the position exactly.",
          ),
        label: z
          .string()
          .describe(
            "The first few words (at most five) of the concept at that position, copied from the list. Write this BEFORE the score: restating what you are judging is what keeps the score anchored to the right concept. It is not used to identify the concept — the index is.",
          ),
        score: z
          .number()
          .describe(
            "Relevance of that concept to the question and plan, 0-100. 100 means highly likely to lead to the answer; 0 means irrelevant.",
          ),
      }),
    )
    .describe(
      `The concepts worth following, as positions in the input list. Return ONLY those scoring above 50 — omitting a concept is how you reject it.`,
    ),
});

const inputSchema = z.object({
  question: z.string().describe("The user question"),
  rationalPlan: z.string().describe("The rational plan to use to answer the user question"),
  keyConcepts: z
    .array(
      z.object({
        index: z.number().int().describe("This concept's position. Refer to the concept by THIS number."),
        keyConcept: z.string().describe("Key Concept"),
      }),
    )
    .describe("The key concepts to analyse, each with the position you must use to refer to it"),
});

@Injectable()
export class KeyConceptsNodeService {
  private readonly logger = new Logger(KeyConceptsNodeService.name);
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly keyConceptRepository: KeyConceptRepository,
    private readonly webSocketService: WebSocketService,
    private readonly clsService: ClsService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.contextualiser?.keyConceptExtractor ?? defaultKeyConceptsPrompt;
  }

  async execute(params: { state: typeof ContextualiserContext.State }): Promise<Partial<ContextualiserContextState>> {
    let keyConcepts: KeyConcept[] = [];

    if (params.state.nextStep === "key_concepts") {
      keyConcepts = await this.keyConceptRepository.findPotentialKeyConcepts({
        question: params.state.question,
        dataLimits: params.state.limits,
        // Billed to the scope this retrieval searches — see chunk.vector.node.service.
        attribution: buildRetrievalAttribution({
          contentId: params.state.contentId,
          contentType: params.state.contentType,
          dataLimits: params.state.limits,
          scope: params.state,
        }),
        // Reuses the embedding chunk_vector already computed this turn instead
        // of embedding the same question twice. Falls back to embedding
        // itself when undefined (e.g. a run that reaches this node without
        // chunk_vector having executed).
        queryEmbedding: params.state.questionEmbedding,
      });
      this.logger.log(
        `findPotentialKeyConcepts → ${keyConcepts.length} concepts ` +
          `(question="${params.state.question}" howToMode=${!!params.state.limits.howToMode} ` +
          `limitToHowToId=${params.state.limits.limitToHowToId ?? "none"})`,
      );
    } else if (params.state.nextStep === "neighbouring_nodes") {
      params.state.neighbouringAlreadyExplored = true;
      keyConcepts = await this.keyConceptRepository.findNeighboursByKeyConcepts({
        keyConcepts: params.state.processedKeyConcepts,
        dataLimits: params.state.limits,
      });
      this.logger.log(
        `findNeighboursByKeyConcepts → ${keyConcepts.length} concepts ` +
          `(from ${params.state.processedKeyConcepts.length} processed)`,
      );
    }

    const usableNodes = keyConcepts
      .filter((keyConcept: KeyConcept) => !params.state.processedKeyConcepts.includes(keyConcept.value))
      .map((keyConcept: KeyConcept) => ({ keyConcept: keyConcept.value }));

    // Safety check: nothing left to explore. The run-wide ceiling is the call
    // budget in contextualiser.service.ts — this node no longer carries a
    // second, disagreeing one of its own.
    if (!usableNodes || !usableNodes.length) {
      this.logger.warn(
        `key_concepts → answer (no usable concepts): usableNodes=${usableNodes?.length ?? 0} ` +
          `processedKeyConcepts=${params.state.processedKeyConcepts.length}`,
      );
      // Delta only: ContextualiserContext.tokens is additive, so returning the
      // whole state re-adds every token accumulated so far. The node consumed
      // one graph hop and `neighbouringAlreadyExplored` is mutated on
      // `params.state` above, so both stay in the delta. No provider call was
      // made on this path, so it reports no `llmCalls`.
      return {
        nextStep: "answer",
        hops: params.state.hops + 1,
        neighbouringAlreadyExplored: params.state.neighbouringAlreadyExplored,
        queuedKeyConcepts: [],
      };
    }

    const inputParams: z.infer<typeof inputSchema> = {
      rationalPlan: params.state.rationalPlan,
      question: params.state.question,
      // The model answers with positions in THIS array, so the numbering it is
      // given and the array the answer maps back into must stay in one order.
      keyConcepts: usableNodes.map((node, index) => ({ index, keyConcept: node.keyConcept })),
    };

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema: inputSchema,
      inputParams: inputParams,
      outputSchema: outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.1,
      metadata: { agentName: "contextualiser", nodeName: "key_concepts" },
      // Billed to the CALLING agent: its ledger category, its entity. Spread
      // LAST so nothing above can overwrite the attribution.
      ...buildInheritedAttribution(params.state),
    });

    if (params.state.contentType === "Conversation")
      await this.webSocketService.sendMessageToUser(this.clsService.get("userId"), "contextualiser", {
        message: llmResponse.status,
        conversationId: params.state.contentId,
      });

    // The INDEX identifies the concept; the `label` exists only so the model
    // restates what it is judging before it scores it. Measured: dropping the
    // restatement entirely (index + score alone) kept the same NUMBER of
    // concepts but selected a materially worse SET — atomic-fact yield fell 25%
    // across the eval corpus, on 13 of 20 questions. See Gate 3b in
    // docs/superpowers/reports/2026-08-21-contextualiser-phase3-report.md.
    const scoredConcepts = (llmResponse.keyConcepts ?? []).filter(
      (scored: { index: number; score: number }) =>
        Number.isInteger(scored.index) && scored.index >= 0 && scored.index < usableNodes.length,
    );

    // A label that does not match its index means the model lost position
    // discipline — the score then belongs to a different concept than the one
    // queued. Diagnostic only: the index still wins, because a mismatched label
    // is no evidence about which of the two is wrong.
    const drifted = scoredConcepts.filter(
      (scored: { index: number; label?: string }) =>
        !!scored.label &&
        !usableNodes[scored.index].keyConcept.toLowerCase().startsWith(scored.label.trim().toLowerCase().slice(0, 12)),
    ).length;
    if (drifted > 0)
      this.logger.warn(`key_concepts: ${drifted}/${scoredConcepts.length} labels did not match their index`);

    const keyConceptsQueue: string[] = scoredConcepts
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .map((scored: { index: number }) => usableNodes[scored.index].keyConcept)
      .slice(0, MAX_KEY_CONCEPTS);

    const returnedHops = params.state.hops + 1;

    return {
      hops: returnedHops,
      llmCalls: 1,
      queuedKeyConcepts: keyConceptsQueue,
      nextStep: "atomic_facts",
      status: [llmResponse.status],
      tokens: llmResponse.tokenUsage,
    };
  }
}
