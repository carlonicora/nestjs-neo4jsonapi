import { Injectable, Logger } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { randomUUID } from "crypto";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { Conversation, ConversationDescriptor, ConversationMessage } from "../entities/conversation";
import { ConversationRepository } from "../repositories/conversation.repository";
import { UserModulesRepository } from "../repositories/user-modules.repository";
import { ChatbotToolCall } from "../interfaces/chatbot.response.interface";
import { ChatbotService } from "./chatbot.service";

/**
 * Maximum number of prior messages (turns) passed to the LLM on each turn.
 * Keeps prompt size and cost bounded for long conversations.
 */
export const MAX_MESSAGES_TO_LLM = 20;

/**
 * ConversationService
 *
 * Wraps the stateless ChatbotService.run() in a stateful lifecycle. Extends
 * AbstractService so standard CRUD (find / findById / patch / delete) is
 * inherited and wired through the framework's JSON:API pipeline — only the
 * agent-turn methods below are bespoke:
 *   - `createWithFirstMessage` — persists a brand-new conversation with the first turn.
 *   - `appendMessage` — appends a user turn + agent turn to an existing conversation.
 *
 * Entities in `references` from prior turns are surfaced to the LLM as a
 * system-message "entity memory" hint so the agent can call `read_entity` directly
 * without having to re-search.
 *
 * NOTE on storage: Neo4j cannot store arbitrary objects as properties, so the
 * `messages` JSON array is stringified on write and parsed on read (see `hydrate`).
 */
@Injectable()
export class ConversationService extends AbstractService<Conversation, typeof ConversationDescriptor.relationships> {
  protected readonly descriptor = ConversationDescriptor;
  private readonly convoLogger = new Logger(ConversationService.name);

  constructor(
    jsonApiService: JsonApiService,
    conversationRepository: ConversationRepository,
    clsService: ClsService,
    private readonly userModulesRepository: UserModulesRepository,
    private readonly chatbot: ChatbotService,
  ) {
    super(jsonApiService, conversationRepository, clsService, ConversationDescriptor.model);
  }

  async createWithFirstMessage(params: {
    companyId: string;
    userId: string;
    roles: string[];
    firstMessage: string;
    title?: string;
  }): Promise<Conversation> {
    const userModules = await this.userModulesRepository.findModulesForRoles(params.roles);
    const title = params.title?.trim() || this.autoTitle(params.firstMessage);
    const now = new Date().toISOString();

    const userMessage: ConversationMessage = {
      id: randomUUID(),
      role: "user",
      content: params.firstMessage,
      createdAt: now,
    };

    const { assistantMessage } = await this.runAgentTurn({
      companyId: params.companyId,
      userId: params.userId,
      userModules,
      priorMessages: [],
      newUserMessage: userMessage,
    });

    const id = randomUUID();
    const messages = [userMessage, assistantMessage];

    this.convoLogger.log(
      `createWithFirstMessage: id=${id} userId=${params.userId} companyId=${params.companyId} titleLength=${title.length} messages=${messages.length}`,
    );

    await this.repository.create({
      id,
      title,
      messages: JSON.stringify(messages),
    });

    return this.loadHydrated(id);
  }

  async appendMessage(params: {
    conversationId: string;
    companyId: string;
    userId: string;
    roles: string[];
    newMessage: string;
  }): Promise<{
    conversation: Conversation;
    userMessage: ConversationMessage;
    assistantMessage: ConversationMessage;
    toolCalls: ChatbotToolCall[];
  }> {
    // Repository enforces owner-RBAC (via buildUserHasAccess) and throws 403/404 on miss.
    const conversation = await this.loadHydrated(params.conversationId);
    const userModules = await this.userModulesRepository.findModulesForRoles(params.roles);

    const userMessage: ConversationMessage = {
      id: randomUUID(),
      role: "user",
      content: params.newMessage,
      createdAt: new Date().toISOString(),
    };

    const { assistantMessage, toolCalls } = await this.runAgentTurn({
      companyId: params.companyId,
      userId: params.userId,
      userModules,
      priorMessages: conversation.messages,
      newUserMessage: userMessage,
    });

    const messages = [...conversation.messages, userMessage, assistantMessage];

    this.convoLogger.log(
      `appendMessage: id=${params.conversationId} userId=${params.userId} priorLen=${conversation.messages.length} newLen=${messages.length}`,
    );

    await this.repository.patch({
      id: params.conversationId,
      messages: JSON.stringify(messages),
    });

    const updated = await this.loadHydrated(params.conversationId);
    return { conversation: updated, userMessage, assistantMessage, toolCalls };
  }

  /**
   * Load a typed Conversation with its `messages` JSON hydrated to an array.
   *
   * Uses the inherited typed read via the repository directly (bypasses JSON:API
   * serialisation) — callers that need JSON:API responses should go through
   * `findById` which the framework wires through createCrudHandlers.
   */
  private async loadHydrated(id: string): Promise<Conversation> {
    const entity = await this.repository.findById({ id });
    return this.hydrate(entity);
  }

  /**
   * Parse `messages` JSON string back to an array. Handles the case where
   * the driver already returned a parsed array (e.g. during tests) as well as
   * empty/malformed strings defensively.
   */
  private hydrate(entity: Conversation): Conversation {
    const raw = entity.messages as unknown;
    let messages: ConversationMessage[] = [];
    if (Array.isArray(raw)) {
      messages = raw as ConversationMessage[];
    } else if (typeof raw === "string" && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) messages = parsed as ConversationMessage[];
      } catch {
        this.convoLogger.warn(
          `hydrate: failed to parse messages for conversation id=${entity.id} — using empty array`,
        );
      }
    }
    return { ...entity, messages };
  }

  /**
   * Runs a single agent turn. Builds a message list of:
   *   [ optional reference-memory system message, ...last 20 prior messages, new user message ]
   * and invokes the stateless chatbot. Returns the assistant reply + recorded tool calls.
   */
  private async runAgentTurn(params: {
    companyId: string;
    userId: string;
    userModules: string[];
    priorMessages: ConversationMessage[];
    newUserMessage: ConversationMessage;
  }): Promise<{ assistantMessage: ConversationMessage; toolCalls: ChatbotToolCall[] }> {
    const hydrationContent = this.buildHydrationMessage(params.priorMessages);
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

    const assistantMessage: ConversationMessage = {
      id: randomUUID(),
      role: "assistant",
      content: response.answer,
      createdAt: new Date().toISOString(),
      references: response.references,
      suggestedQuestions: response.suggestedQuestions,
      tokens: response.tokens,
    };
    return { assistantMessage, toolCalls: response.toolCalls };
  }

  /**
   * Build the reference-memory system message — a de-duplicated list of every
   * entity referenced in prior turns. Returns null if there is nothing to hydrate.
   */
  private buildHydrationMessage(messages: ConversationMessage[]): string | null {
    const seen = new Map<string, string>(); // key: "type/id" → reason
    for (const msg of messages) {
      for (const ref of msg.references ?? []) {
        const key = `${ref.type}/${ref.id}`;
        if (!seen.has(key)) seen.set(key, ref.reason);
      }
    }
    if (seen.size === 0) return null;
    const lines = Array.from(seen.entries()).map(([key, reason]) => `- ${key}: ${reason}`);
    return `The following entities have been referenced earlier in this conversation.\nYou can call read_entity(type, id) on any of them directly without re-searching:\n${lines.join("\n")}`;
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
