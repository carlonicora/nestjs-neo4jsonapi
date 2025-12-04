import { Inject, Injectable, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { z } from "zod";
import { LLMService } from "../../../core/llm/services/llm.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { KeyConcept } from "../../../foundations/keyconcept/entities/key.concept.entity";
import { KeyConceptRepository } from "../../../foundations/keyconcept/repositories/keyconcept.repository";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";
import { CONTEXTUALISER_KEYCONCEPTS_PROMPT } from "../../prompts/prompt.tokens";

export const defaultKeyConceptsPrompt = `
As an intelligent assistant, your primary objective is to score a list of key concepts in relation to the user question.

You are given the question, the rational plan, and a list of key elements with additional metadata.
Your must check a list of Key Concepts, with the objective of selecting the most relevant ones to efficiently answer the question.
These initial key concepts are crucial because they are the starting point for searching for relevant information.

Given the **question**, the **rational plan** to answer the question, and the list of **Key Concepts** you have to:
1. for each key concept
  - Read the key concept
  - Read the metadata (if they are available)
  - Assess a relevance to the potential answer by assigning a score between 0 and 100. A score of 100 implies a high likelihood of relevance to the answer, whereas a score of 0 suggests minimal relevance.
  - If the key element contains metadata and the metadata is very relevant to the question and it will be used to answer the question, please indicate that the key element is used as a source for the answer setting isUsedAsSource to true. In any other case (there is no metadata or the metadata is not relevant to the question), set isUsedAsSource to false.
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
      `Write a short, friendly message (max 40 characters) about your action, avoiding technical terms such as "nodes" or "atomic facts" or "key Concepts". Give flavour to the message and avoid repeating the same message.`,
    ),
  keyConcepts: z
    .array(
      z.object({
        keyConcept: z.string().describe(`name of a relevant keyConcepts`),
        score: z
          .number()
          .describe(
            `Relevance to the potential answer by assigning a score between 0 and 100. A score of 100 implies a high likelihood of relevance to the answer, whereas a score of 0 suggests minimal relevance.`,
          ),
        isUsedAsSource: z.boolean().describe(`Indicate if the keyConcept is used as a source for the answer`),
      }),
    )
    .describe(`List of relevant keyConcepts to the question and plan`),
});

const inputSchema = z.object({
  question: z.string().describe("The user question"),
  rationalPlan: z.string().describe("The rational plan to use to answer the user question"),
  keyConcepts: z
    .array(
      z.object({
        keyConcept: z.string().describe("Key Concept"),
        metadata: z.any().optional().describe("The metadata associated with the key concept"),
      }),
    )
    .describe("The key concepts to analyse"),
});

@Injectable()
export class KeyConceptsNodeService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly keyConceptRepository: KeyConceptRepository,
    private readonly webSocketService: WebSocketService,
    private readonly clsService: ClsService,
    @Optional() @Inject(CONTEXTUALISER_KEYCONCEPTS_PROMPT) customPrompt?: string,
  ) {
    this.systemPrompt = customPrompt ?? defaultKeyConceptsPrompt;
  }

  async execute(params: { state: typeof ContextualiserContext.State }): Promise<Partial<ContextualiserContextState>> {
    params.state.hops += 1;

    let keyConcepts: KeyConcept[] = [];

    if (params.state.nextStep === "key_concepts") {
      keyConcepts = await this.keyConceptRepository.findPotentialKeyConcepts({
        question: params.state.question,
        dataLimits: params.state.limits,
      });
    } else if (params.state.nextStep === "negbouring_nodes") {
      params.state.neighbouringAlreadyExplored = true;
      keyConcepts = await this.keyConceptRepository.findNeighboursByKeyConcepts({
        keyConcepts: params.state.processedKeyConcepts,
        dataLimits: params.state.limits,
      });
    }

    const metadataList: { node: string; metadata: any }[] = [];

    const usableNodes = keyConcepts
      .filter((keyConcept: KeyConcept) => !params.state.processedKeyConcepts.includes(keyConcept.value))
      .map((keyConcept: KeyConcept) => {
        const metadata = [];

        return {
          keyConcept: keyConcept.value,
          metadata: metadata,
        };
      });

    // Safety check: If approaching max hops or no usable nodes, stop exploration
    const approachingMaxHops = params.state.hops >= 15;

    if (!usableNodes || !usableNodes.length || approachingMaxHops) {
      params.state.nextStep = "answer";
      return params.state;
    }

    const inputParams: z.infer<typeof inputSchema> = {
      rationalPlan: params.state.rationalPlan,
      question: params.state.question,
      keyConcepts: usableNodes,
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

    llmResponse.keyConcepts.forEach((node: { keyConcept: string; score: number; isUsedAsSource: boolean }) => {
      if (node.isUsedAsSource) {
        const keyConcept: string = node.keyConcept.split(" - Metadata ")[0];
        if (!keyConcept) return;

        const metadata: any[] = metadataList.find((el) => el.node === keyConcept)?.metadata;
        if (!metadata) return;

        metadata.forEach((singleMetadata) => {
          // const meta = this._transformMetadata({ node: keyConcept, metadata: singleMetadata });

          //         params.state.notebook = `${params.state.notebook}
          // ${meta}`;
          if (keyConcept) params.state.ontology.push(singleMetadata.id);
        });
      }
    });

    const allowableConcepts = keyConcepts
      .filter((keyConcept: KeyConcept) => !params.state.processedKeyConcepts.includes(keyConcept.value))
      .map((el) => el.value);
    const generatedConcepts = llmResponse.keyConcepts.filter((el: any) => allowableConcepts.includes(el.keyConcept));

    const keyConceptsQueue: string[] = generatedConcepts
      .sort((a: any, b: any) => b.score - a.score)
      .map((el: any) => el.keyConcept)
      .slice(0, 10);

    const returnedHops = params.state.hops + 1;

    return {
      hops: returnedHops,
      queuedKeyConcepts: keyConceptsQueue,
      nextStep: "atomic_facts",
      status: [llmResponse.status],
      tokens: llmResponse.tokenUsage,
    };
  }

  private _transformMetadata(params: { node: string; metadata: any }): string {
    let response = `Metadata for ${params.node} > `;

    response += `Type: ${params.metadata.type}`;

    if (params.metadata.data && typeof params.metadata.data === "object") {
      Object.entries(params.metadata.data).forEach(([key, value]) => {
        response += `, ${key}: ${value}`;
      });
    }

    return response;
  }
}
