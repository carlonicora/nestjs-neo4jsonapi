import { Inject, Injectable, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { z } from "zod";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { TracingService } from "../../../core/tracing/services/tracing.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { AtomicFact } from "../../../foundations/atomicfact/entities/atomic.fact.entity";
import { AtomicFactRepository } from "../../../foundations/atomicfact/repositories/atomicfact.repository";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";
import { CONTEXTUALISER_ATOMICFACTS_PROMPT } from "../../prompts/prompt.tokens";

export const defaultAtomicFactsPrompt = `
As an intelligent assistant, your primary objective is to evaluate the atomic facts provided, to determine whether they are contextually relevant to the user question.
You have been provided with a list of atomic facts, which are the smallest, indivisible truths extracted from text chunks.

**Important Constraints:**
- **You must ONLY use the chunkIds from the atomic facts provided.**

Given the **question**, the **rational plan**, for each of the atomic facts provided you **MUST**:
- Analyse the content of the atomic fact as context to the question
- Determine its relevance to the question and plan
- if the atomic fact is relevant to the question and plan, you must include the chunkId of the atomic fact in the list of chunks to analyse

**Provide a Status Message**:
  - Write a **short, friendly message** (maximum 40 characters) about your action.
  - **Avoid technical terms** such as "nodes", "atomic facts", or "key concepts".
  - The status message should make the user understand the action being taken
  - The status message **MUST** contain clear information contextualised to the current question and the gathered information.
  - The status message should be specific to the context and clearly convey the next steps or actions being taken.
  - The status message **MUST NOT** be something unrelated to the text, such as "success", "sufficient information", "insufficient information", "chunk analysed", "chunk processed" or similar generic messages.

When you have analysed all the atomic facts, you must create a short **annotation** containing information that give context to the question.

### **Please strictly follow the above instructions and format. Let's begin.**
`;

const outputSchema = z.object({
  status: z
    .string()
    .describe(
      `Write a short, friendly message (max 40 characters) about your action, avoiding technical terms such as "nodes" or "atomic facts" or  "key concepts". Give flavour to the message and avoid  repeating the same message.`,
    ),
  annotations: z
    .string()
    .describe(
      `Write the new insights and findings about the question from current atomic facts. These will be appended to your notebook, creating a more complete version of the notebook that contains more valid information. The new insights and findings should be an analysis of the information as read by you, written in a format that better suits your analysis abilities. In the notebook you should not refer to "text chunks" or "nodes" or "atomic facts".`,
    ),
  chunksToAnalyse: z.array(z.string()).describe(`List of chunk IDs to analyse`),
});

const inputSchema = z.object({
  question: z.string().describe("The user question"),
  rationalPlan: z.string().describe("The rational plan to use to answer the user question"),
  atomicFacts: z
    .array(
      z.object({
        chunkId: z.string().describe("The ID of the chunk associated with the atomic fact"),
        fact: z.string().describe("The content of the atomic fact"),
      }),
    )
    .describe("The atomic facts to keep into consideration"),
});

@Injectable()
export class AtomicFactsNodeService {
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly atomicFactRepository: AtomicFactRepository,
    private readonly logger: AppLoggingService,
    private readonly tracer: TracingService,
    private readonly webSocketService: WebSocketService,
    private readonly clsService: ClsService,
    @Optional() @Inject(CONTEXTUALISER_ATOMICFACTS_PROMPT) customPrompt?: string,
  ) {
    this.systemPrompt = customPrompt ?? defaultAtomicFactsPrompt;
  }

  async execute(params: { state: typeof ContextualiserContext.State }): Promise<Partial<ContextualiserContextState>> {
    const filteredKeyConcepts = params.state.queuedKeyConcepts.filter(
      (el) => !params.state.processedKeyConcepts.includes(el),
    );

    if (filteredKeyConcepts.length === 0) {
      return {
        queuedKeyConcepts: [],
        nextStep: params.state.queuedChunks.length > 0 ? "chunks" : "answer",
      };
    }

    const atomicFacts = await this.atomicFactRepository.findAtomicFactsByKeyConcepts({
      keyConcepts: filteredKeyConcepts,
      skipChunkIds: params.state.processedChunks,
      skipAtomicFactIds: params.state.processedAtomicFacts,
      dataLimits: params.state.limits,
    });

    this.tracer.addSpanEvent("atomicfacts.retrieved", {
      keyConcepts: JSON.stringify(filteredKeyConcepts, null, 2),
      retrievedAtomicFacts: JSON.stringify(
        atomicFacts.map((fact: AtomicFact) => ({ id: fact.id, name: fact.content })),
        null,
        2,
      ),
    });

    const filteredAtomicFacts = atomicFacts.filter(
      (atomicFact: AtomicFact) =>
        !params.state.processedAtomicFacts.includes(atomicFact.id) &&
        !params.state.processedChunks.includes(atomicFact.chunk.id),
    );

    if (filteredAtomicFacts.length === 0) {
      return {
        nextStep: params.state.queuedChunks.length > 0 ? "chunks" : "answer",
      };
    }

    const MAX_GROUP_SIZE = 50;
    const atomicFactGroups: AtomicFact[][] = [];
    for (let i = 0; i < filteredAtomicFacts.length; i += MAX_GROUP_SIZE) {
      atomicFactGroups.push(filteredAtomicFacts.slice(i, i + MAX_GROUP_SIZE));
    }

    const llmResponses: {
      chunkIds: string[];
      annotations: string;
      status: string;
      tokenUsage: TokenUsageInterface;
    }[] = await Promise.all(
      atomicFactGroups.map(async (atomicFacts: AtomicFact[]) => {
        const atomicFactList: { chunkId: string; fact: string }[] = atomicFacts.map((atomicFact: AtomicFact) => ({
          chunkId: atomicFact.chunk.id,
          fact: atomicFact.content,
        }));

        const inputParams: z.infer<typeof inputSchema> = {
          rationalPlan: params.state.rationalPlan,
          question: params.state.question,
          atomicFacts: atomicFactList,
        };

        const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
          inputSchema: inputSchema,
          inputParams: inputParams,
          outputSchema: outputSchema,
          systemPrompts: [this.systemPrompt],
          temperature: 0.1,
        });

        const chunkIds = new Set<string>();
        if (llmResponse.chunksToAnalyse && llmResponse.chunksToAnalyse.length > 0) {
          llmResponse.chunksToAnalyse.forEach((chunkId) => chunkIds.add(chunkId));
        }

        if (params.state.contentType === "Conversation")
          await this.webSocketService.sendMessageToUser(this.clsService.get("userId"), "contextualiser", {
            message: llmResponse.status,
            conversationId: params.state.contentId,
          });

        return {
          chunkIds: Array.from(chunkIds),
          status: llmResponse.status,
          annotations: llmResponse.annotations,
          tokenUsage: llmResponse.tokenUsage,
        };
      }),
    );

    const tokenUsed: TokenUsageInterface = {
      input: 0,
      output: 0,
    };

    const validChunkIds = new Set<string>();
    const annotations: string[] = [];

    const statuses: string[] = [];
    for (const llmResponse of llmResponses) {
      annotations.push(llmResponse.annotations);
      if (!statuses.includes(llmResponse.status) && !params.state.status.includes(llmResponse.status))
        statuses.push(llmResponse.status);
      tokenUsed.input += llmResponse.tokenUsage.input || 0;
      tokenUsed.output += llmResponse.tokenUsage.output || 0;
      if (llmResponse.chunkIds) {
        llmResponse.chunkIds.forEach((chunkId) => validChunkIds.add(chunkId));
      }
    }

    params.state.processedChunks.forEach((chunkId) => validChunkIds.delete(chunkId));
    let queuedChunks = [];
    let nextStep = "neighbouring_nodes";

    // Safety check: Don't queue new chunks if we're approaching the maxHops limit
    const approachingMaxHops = params.state.hops >= 15;

    if (validChunkIds.size === 0 || approachingMaxHops) {
      if (params.state.processedKeyConcepts.length === 0 || params.state.neighbouringAlreadyExplored) {
        nextStep = "answer";
      }
    } else {
      nextStep = "chunks";
      queuedChunks = [...Array.from(validChunkIds)];
    }

    const returnedHops = params.state.hops + 1;

    return {
      hops: returnedHops,
      annotations: annotations.join("\n"),
      processedKeyConcepts: filteredKeyConcepts,
      processedAtomicFacts: filteredAtomicFacts.map((atomicFact: AtomicFact) => atomicFact.id),
      queuedKeyConcepts: [],
      status: statuses,
      queuedChunks: queuedChunks,
      nextStep: nextStep,
      tokens: tokenUsed,
    };
  }
}
