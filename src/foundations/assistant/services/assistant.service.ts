import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { ChatbotService } from "../../../agents/chatbot/services/chatbot.service";
import { UserModulesRepository } from "../../../agents/chatbot/repositories/user-modules.repository";
import { ChatbotReference, ChatbotToolCall } from "../../../agents/chatbot/interfaces/chatbot.response.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { AssistantMessage, AssistantMessageDescriptor } from "../../assistant-message/entities/assistant-message";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { AssistantMessageRepository } from "../../assistant-message/repositories/assistant-message.repository";
import { AssistantMessageService } from "../../assistant-message/services/assistant-message.service";
import { Assistant, AssistantDescriptor } from "../entities/assistant";
import { assistantMeta } from "../entities/assistant.meta";
import { AssistantRepository } from "../repositories/assistant.repository";

/**
 * Maximum number of prior messages (turns) passed to the LLM on each turn.
 * Keeps prompt size and cost bounded for long conversations.
 */
export const MAX_MESSAGES_TO_LLM = 20;

/**
 * Shape of a single agent turn returned from `runAgentTurn`. Not persisted —
 * this is an in-memory view used to then create AssistantMessage node(s).
 */
interface AgentTurnResult {
  id: string;
  role: "assistant";
  content: string;
  createdAt: string;
  references: ChatbotReference[];
  suggestedQuestions: string[];
  tokens: { input: number; output: number };
  toolCalls: ChatbotToolCall[];
}

/**
 * AssistantService
 *
 * Wraps the stateless ChatbotService.run() in a stateful lifecycle. Extends
 * AbstractService so standard CRUD (find / findById / patch / delete) is
 * inherited and wired through the framework's JSON:API pipeline — only the
 * agent-turn methods below are bespoke:
 *   - `createWithFirstMessage` — persists a brand-new assistant thread with the first turn.
 *   - `appendMessage` — appends a user turn + agent turn to an existing assistant thread.
 *
 * Messages are stored as first-class `AssistantMessage` nodes linked via
 * `(Assistant)-[:HAS_MESSAGE]->(AssistantMessage)`. Per-turn `references` are
 * materialised as `(AssistantMessage)-[:REFERENCES]->(entity)` edges (see
 * AssistantMessageRepository.linkReferences).
 */
@Injectable()
export class AssistantService extends AbstractService<Assistant, typeof AssistantDescriptor.relationships> {
  protected readonly descriptor = AssistantDescriptor;
  private readonly assistantLogger = new Logger(AssistantService.name);

  constructor(
    jsonApiService: JsonApiService,
    assistantRepository: AssistantRepository,
    clsService: ClsService,
    private readonly userModulesRepository: UserModulesRepository,
    private readonly chatbot: ChatbotService,
    private readonly assistantMessages: AssistantMessageService,
    private readonly assistantMessageRepo: AssistantMessageRepository,
  ) {
    super(jsonApiService, assistantRepository, clsService, AssistantDescriptor.model);
  }

  async createWithFirstMessage(params: {
    companyId: string;
    userId: string;
    roles: string[];
    firstMessage: string;
    title?: string;
  }): Promise<{
    assistant: Assistant;
    userMessage: AssistantMessage;
    assistantMessage: AssistantMessage;
    toolCalls: ChatbotToolCall[];
  }> {
    const userModules = await this.userModulesRepository.findModulesForRoles(params.roles);
    const title = params.title?.trim() || this.autoTitle(params.firstMessage);

    const assistantId = randomUUID();
    const userMessageId = randomUUID();

    // 1. Create the Assistant (owner edge attached from CLS via contextKey).
    await this.createFromDTO({
      data: {
        type: assistantMeta.type,
        id: assistantId,
        attributes: { title },
      },
    });

    // 2. Create the first user message at position 0.
    await this.assistantMessages.createFromDTO({
      data: {
        type: assistantMessageMeta.type,
        id: userMessageId,
        attributes: {
          role: "user",
          content: params.firstMessage,
          position: 0,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: assistantId } },
        },
      },
    });
    const userMessage = await this.assistantMessageRepo.findById({ id: userMessageId });

    // 3. Run the agent turn using the just-created user message as context.
    const turn = await this.runAgentTurn({
      companyId: params.companyId,
      userId: params.userId,
      userModules,
      priorMessages: [],
      newUserMessage: { role: "user", content: params.firstMessage },
    });

    // 4. Create the assistant message at position 1 with denormalised references JSON.
    const assistantMessageId = turn.id;
    await this.assistantMessages.createFromDTO({
      data: {
        type: assistantMessageMeta.type,
        id: assistantMessageId,
        attributes: {
          role: "assistant",
          content: turn.content,
          position: 1,
          suggestedQuestions: turn.suggestedQuestions,
          inputTokens: turn.tokens.input,
          outputTokens: turn.tokens.output,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: assistantId } },
        },
      },
    });

    // 5. Materialise REFERENCES edges (no-op when references is empty).
    if (turn.references.length) {
      await this.assistantMessageRepo.linkReferences({
        messageId: assistantMessageId,
        references: turn.references,
      });
    }
    const assistantMessage = await this.assistantMessageRepo.findById({ id: assistantMessageId });

    this.assistantLogger.log(
      `createWithFirstMessage: id=${assistantId} userId=${params.userId} companyId=${params.companyId} titleLength=${title.length}`,
    );

    const assistant = await this.repository.findById({ id: assistantId });
    return { assistant, userMessage, assistantMessage, toolCalls: turn.toolCalls };
  }

  async appendMessage(params: {
    assistantId: string;
    companyId: string;
    userId: string;
    roles: string[];
    newMessage: string;
  }): Promise<{
    userMessage: AssistantMessage;
    assistantMessage: AssistantMessage;
    toolCalls: ChatbotToolCall[];
  }> {
    // Verify ownership via the owner-RBAC-enforcing findById.
    await this.repository.findById({ id: params.assistantId });
    const userModules = await this.userModulesRepository.findModulesForRoles(params.roles);

    // Load prior messages for agent context.
    const priorMessages = await this.loadRecentMessages({
      assistantId: params.assistantId,
      limit: MAX_MESSAGES_TO_LLM,
    });

    const nextPosition = await this.assistantMessageRepo.getNextPosition({
      assistantId: params.assistantId,
    });

    const userMessageId = randomUUID();

    await this.assistantMessages.createFromDTO({
      data: {
        type: assistantMessageMeta.type,
        id: userMessageId,
        attributes: {
          role: "user",
          content: params.newMessage,
          position: nextPosition,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: params.assistantId } },
        },
      },
    });
    const userMessage = await this.assistantMessageRepo.findById({ id: userMessageId });

    const turn = await this.runAgentTurn({
      companyId: params.companyId,
      userId: params.userId,
      userModules,
      priorMessages,
      newUserMessage: { role: "user", content: params.newMessage },
    });

    const assistantMessageId = turn.id;
    await this.assistantMessages.createFromDTO({
      data: {
        type: assistantMessageMeta.type,
        id: assistantMessageId,
        attributes: {
          role: "assistant",
          content: turn.content,
          position: nextPosition + 1,
          suggestedQuestions: turn.suggestedQuestions,
          inputTokens: turn.tokens.input,
          outputTokens: turn.tokens.output,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: params.assistantId } },
        },
      },
    });

    if (turn.references.length) {
      await this.assistantMessageRepo.linkReferences({
        messageId: assistantMessageId,
        references: turn.references,
      });
    }
    const assistantMessage = await this.assistantMessageRepo.findById({ id: assistantMessageId });

    this.assistantLogger.log(
      `appendMessage: id=${params.assistantId} userId=${params.userId} newPos=${nextPosition}-${nextPosition + 1}`,
    );

    return { userMessage, assistantMessage, toolCalls: turn.toolCalls };
  }

  /**
   * Load the most recent N messages for an Assistant, ordered chronologically
   * (position ASC). Used to build the LLM prompt without pulling full history.
   */
  private async loadRecentMessages(params: { assistantId: string; limit: number }): Promise<AssistantMessage[]> {
    const all = await this.assistantMessageRepo.findByRelated({
      relationship: AssistantMessageDescriptor.relationshipKeys.assistant,
      id: params.assistantId,
      cursor: { limit: params.limit },
      orderBy: "-position",
    } as any);
    return (all as AssistantMessage[]).slice(0, params.limit).reverse();
  }

  /**
   * Runs a single agent turn. Builds a message list of:
   *   [ optional reference-memory system message, ...prior messages, new user message ]
   * and invokes the stateless chatbot. Returns the assistant reply metadata.
   */
  private async runAgentTurn(params: {
    companyId: string;
    userId: string;
    userModules: string[];
    priorMessages: AssistantMessage[];
    newUserMessage: { role: "user"; content: string };
  }): Promise<AgentTurnResult> {
    const hydrationContent = await this.buildHydrationMessage(params.priorMessages);
    const trimmed = params.priorMessages.slice(-MAX_MESSAGES_TO_LLM).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      ...(hydrationContent ? [{ role: "system" as const, content: hydrationContent }] : []),
      ...trimmed,
      { role: params.newUserMessage.role, content: params.newUserMessage.content },
    ];

    const response = await this.chatbot.run({
      companyId: params.companyId,
      userId: params.userId,
      userModules: params.userModules,
      messages,
    });

    return {
      id: randomUUID(),
      role: "assistant",
      content: response.answer,
      createdAt: new Date().toISOString(),
      references: response.references ?? [],
      suggestedQuestions: response.suggestedQuestions ?? [],
      tokens: response.tokens ?? { input: 0, output: 0 },
      toolCalls: response.toolCalls ?? [],
    };
  }

  /**
   * Build a hydration system-message listing every (type/id) referenced by prior messages.
   * Returns null when there is nothing to hydrate.
   */
  private async buildHydrationMessage(messages: AssistantMessage[]): Promise<string | null> {
    if (messages.length === 0) return null;
    const pairs = await this.assistantMessageRepo.findReferencedTypeIdPairs({
      messageIds: messages.map((m) => m.id),
    });
    if (pairs.length === 0) return null;
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const p of pairs) {
      const key = `${p.type}/${p.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    return (
      "The following entities have been referenced earlier in this conversation.\n" +
      "You can call read_entity(type, id) on any of them directly without re-searching:\n" +
      keys.map((k) => `- ${k}`).join("\n")
    );
  }

  /**
   * Auto-generate a title from the first user message: trim to 60 chars on a
   * word boundary. Falls back to a hard 60-char cut if no suitable break exists.
   */
  private autoTitle(firstMessage: string): string {
    const trimmed = firstMessage.trim();
    if (trimmed.length <= 60) return trimmed;
    const at60 = trimmed.slice(0, 60);
    const lastSpace = at60.lastIndexOf(" ");
    return lastSpace > 30 ? at60.slice(0, lastSpace).trim() : at60.trim();
  }
}
