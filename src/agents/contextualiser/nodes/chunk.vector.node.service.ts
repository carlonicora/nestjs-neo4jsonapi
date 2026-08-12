import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { z } from "zod";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { BaseConfigInterface, ConfigPromptsInterface } from "../../../config/interfaces";
import { LLMService } from "../../../core/llm/services/llm.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { ChunkRepository } from "../../../foundations/chunk/repositories/chunk.repository";
import { buildInheritedAttribution, buildRetrievalAttribution } from "../../common/usage-attribution";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";
import { NotebookContext } from "../../contextualiser/contexts/notebook.context";
import { RETRIEVAL_SOURCES, RetrievalSourceContribution } from "../interfaces/retrieval.source.interface";

const NEIGHBOR_WINDOW = 1;

export const defaultChunkVectorPrompt = `
As an intelligent assistant, your primary objective is to assess a specific **text chunk** and determine whether the available information suffices to answer the question.

Given the **question**, and the **rational plan** to answer the question you have to:
1. Write a note summarizing the key points from the current text chunk that are relevant to the question. This must be used as context to answer the question.
  - The note should contain all the information required to provide a detailed answer
  - It should be a comprehensive note that can be used to generate a precise, contextualise reponse to the question, containing all the required details enough to cover all relevant aspects.

2. Write a reason describing how the text chunk is relevant to the question
  - The reason should explain why the text chunk is relevant or not to answer the question.

3. Select the appropriate next action to take based on your assessment of the current information.
  - **queuePreviousChunk**: Choose this action if you feel that the current chunk of text might have relevant information in a previous text chunk that would **significantly** enhance your answer.
  - **queueNextChunk**: Choose this action if you feel that the current chunk of text might have relevant information in a subsequent text chunk that would **significantly** enhance your answer.
  - **readNeighbouringNodes**: Choose this action if you believe that this text chunk does not contain relevant information and that exploring neighbouring chunks could provide valuable context.
  - **answer**: Choose this action if you believe that the information in this text chunk is sufficient to provide a **comprehensive and accurate** answer to the question.

  4. **Provide a Status Message**:
  - Write a **short, friendly message** (maximum 40 characters) about your action.
  - **Avoid technical terms** such as "nodes", "atomic facts", or "key concepts".
  - The status message should make the user understand the action being taken
  - The status message **MUST** contain clear information contextualised to the current question and the gathered information.
  - The status message should be specific to the context and clearly convey the next steps or actions being taken.
  - The status message **MUST NOT** be something unrelated to the text, such as "success", "sufficient information", "insufficient information", "chunk analysed", "chunk processed" or similar generic messages.
  
  ### Important Notes:
  - **Proceed to Answer When Appropriate**: If the current information is sufficient to provide a reliable answer, do not hesitate to proceed to select **answer** as the next step.
  - **Gather More Information When Needed**: If you identify gaps or uncertainties that could be addressed by additional information, choose the appropriate action to gather that information.
  - **Use Judgment in Decision-Making**: Apply thoughtful consideration to decide whether additional information is necessary.
  - If the content contains acronyms and their definition, include the definition of the acronym in your answer.
  
### **Please strictly follow the above instructions and format. Let's begin.**
`;

const outputSchema = z.object({
  status: z
    .string()
    .describe(
      `Write a short, friendly message (max 40 characters) about your action, avoiding technical terms such as "nodes" or "atomic facts" or  "key concepts". Give flavour to the message and avoid repeating the same message.`,
    ),
  note: z
    .object({
      content: z.string().describe("The new insights and findings about the question from current text"),
      reason: z.string().describe("The reason describing how the text chunk is relevant to the question"),
    })
    .describe("The note summarizing the key points from the current text chunk that are relevant to the question"),
  chosenAction: z.string()
    .describe(`This is the action you have decided to do in the next step. You **MUST** pick one of the following actions:
- **queuePreviousChunk**: Choose this action if you feel that the previous text chunk contains valuable information for answering the question.
- **queueNextChunk**: Choose this action if you feel that the subsequent text chunk contains valuable information for answering the question.
- **readNeighbouringNodes**: Choose this action if you feel that the current text contains valuable, but somewhat incomplete information that could be clarified by exploring related concepts.
- **answer**: Choose this action if you believe that the information you have currently obtained is enough to answer the question. This will allow you to summarize the gathered information and provide a final answer.
`),
});

const inputSchema = z.object({
  question: z.string().describe("The question asked by the user"),
  rationalPlan: z
    .string()
    .describe("The rational plan you designed to provide a comprehensive answer to the user question"),
  text: z.string().describe("The content of the text you must analyse to provide an answer to the user question"),
});

@Injectable()
export class ChunkVectorNodeService {
  private readonly logger = new Logger(ChunkVectorNodeService.name);
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    private readonly chunkRepository: ChunkRepository,
    private readonly webSocketService: WebSocketService,
    private readonly clsService: ClsService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    @Optional()
    @Inject(RETRIEVAL_SOURCES)
    private readonly retrievalSources?: RetrievalSourceContribution[],
  ) {
    const prompts = this.configService.get<ConfigPromptsInterface>("prompts");
    this.systemPrompt = prompts?.contextualiser?.chunkVector ?? defaultChunkVectorPrompt;
  }

  async execute(params: { state: typeof ContextualiserContext.State }): Promise<Partial<ContextualiserContextState>> {
    const [chunks, contributed] = await Promise.all([
      this.chunkRepository.findPotentialChunks({
        question: params.state.question,
        dataLimits: params.state.limits,
        // The question embedding is billed to the scope this retrieval searches.
        // Task 10 threaded the CALLING agent's own attribution through this
        // state, and it is now the first branch of the derivation: when another
        // agent confined the turn to a scope root, its embedding spend lands on
        // the same entity as its LLM spend instead of on a second one.
        attribution: buildRetrievalAttribution({
          contentId: params.state.contentId,
          contentType: params.state.contentType,
          dataLimits: params.state.limits,
          scope: params.state,
        }),
      }),
      Promise.all(
        (this.retrievalSources ?? []).map((source) =>
          source
            .search({
              question: params.state.question,
              rationalPlan: params.state.rationalPlan,
              companyId: params.state.companyId,
              dataLimits: params.state.limits,
            })
            .catch((e: Error) => {
              this.logger.warn(`retrieval source contribution failed: ${e.message}`);
              return [];
            }),
        ),
      ).then((lists) => lists.flat()),
    ]);

    // Neighbour-window widening: each retrieved chunk is analysed together with the
    // chunks immediately before/after it, so the LLM sees continuous prose.
    const allRetrievedIds = chunks.map((c) => c.id);
    const neighborRecords = allRetrievedIds.length
      ? await this.chunkRepository.findChunkNeighbors({ chunkIds: allRetrievedIds, window: NEIGHBOR_WINDOW })
      : [];
    const neighborById = new Map(neighborRecords.map((n) => [n.chunkId, n]));
    const widen = (id: string, content: string): string => {
      const n = neighborById.get(id);
      if (!n) return content;
      return [...n.before, content, ...n.after].join("\n\n");
    };

    if (chunks.length === 0 && contributed.length === 0) {
      this.logger.log("chunk_vector: no results — continuing per rational plan routing");
      return {};
    }

    const llmResponses: ({
      chunkId: string;
      status: string;
      note: {
        content: string;
        reason: string;
      };
      chosenAction: string;
      tokens: TokenUsageInterface;
    } | null)[] = (await Promise.all(
      chunks.map(async (chunk: { id: string; content: string }) => {
        if (!chunk.content || chunk.content.trim() === "") return null;

        const inputParams: z.infer<typeof inputSchema> = {
          rationalPlan: params.state.rationalPlan,
          question: params.state.question,
          text: widen(chunk.id, chunk.content),
        };

        const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
          inputSchema: inputSchema,
          inputParams: inputParams,
          outputSchema: outputSchema,
          systemPrompts: [this.systemPrompt],
          temperature: 0.1,
          // Billed to the CALLING agent: its ledger category, its entity. Spread
          // LAST so nothing above can overwrite the attribution.
          ...buildInheritedAttribution(params.state),
        });

        if (params.state.contentType === "Conversation")
          await this.webSocketService.sendMessageToUser(this.clsService.get("userId"), "contextualiser", {
            message: llmResponse.status,
            conversationId: params.state.contentId,
          });

        return {
          chunkId: chunk.id,
          status: llmResponse.status,
          note: {
            content: llmResponse.note?.content ?? "",
            reason: llmResponse.note?.reason ?? "",
          },
          chosenAction: llmResponse.chosenAction,
          tokens: llmResponse.tokenUsage,
        };
      }),
    )) as any;

    const tokenUsed: TokenUsageInterface = {
      input: 0,
      output: 0,
    };
    const newNotebookEntries: (typeof NotebookContext.State)[] = [];
    const statuses: string[] = [];

    for (const llmResponse of llmResponses.filter((response) => !!response)) {
      tokenUsed.input += llmResponse.tokens.input;
      tokenUsed.output += llmResponse.tokens.output;
      newNotebookEntries.push({
        chunkId: llmResponse.chunkId,
        content: llmResponse.note.content,
        reason: llmResponse.note.reason,
        sourceLayer: "case",
        metadata: undefined,
      });
      if (
        llmResponse.status &&
        !statuses.includes(llmResponse.status) &&
        !params.state.status.includes(llmResponse.status)
      ) {
        statuses.push(llmResponse.status);
      }
    }

    for (const entry of contributed) {
      newNotebookEntries.push({
        chunkId: entry.chunkId,
        content: entry.content,
        reason: entry.reason,
        sourceLayer: entry.sourceLayer ?? "case",
        metadata: entry.metadata,
      });
    }

    return {
      hops: params.state.hops + 1,
      processedChunks: chunks.map((c) => c.id),
      notebook: newNotebookEntries,
      status: statuses,
      tokens: tokenUsed,
    };
  }
}
