import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Conversation, ConversationMessage } from "../entities/conversation";
import { ConversationRepository } from "../repositories/conversation.repository";
import { UserModulesRepository } from "../repositories/user-modules.repository";
import { ChatbotService } from "./chatbot.service";
import { ChatbotToolCall } from "../interfaces/chatbot.response.interface";

/**
 * Maximum number of prior messages (turns) passed to the LLM on each turn.
 * Keeps prompt size and cost bounded for long conversations.
 */
export const MAX_MESSAGES_TO_LLM = 20;

/**
 * ConversationService
 *
 * Wraps the stateless ChatbotService.run() in a stateful lifecycle:
 *   - `createWithFirstMessage` — persists a brand-new conversation with the first turn.
 *   - `appendMessage` — appends a user turn + agent turn to an existing conversation.
 *   - `rename` / `remove` / `findById` / `findAll` — owner-scoped CRUD (enforced by repo).
 *
 * Entities in `references` from prior turns are surfaced to the LLM as a
 * system-message "entity memory" hint so the agent can call `read_entity` directly
 * without having to re-search.
 *
 * NOTE on storage: Neo4j cannot store arbitrary objects as properties, so the
 * `messages` JSON array is stringified on write and parsed on read.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly userModulesRepository: UserModulesRepository,
    private readonly chatbot: ChatbotService,
  ) {}

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

    this.logger.log(
      `createWithFirstMessage: id=${id} userId=${params.userId} companyId=${params.companyId} titleLength=${title.length} messages=${messages.length}`,
    );

    await this.conversationRepository.create({
      id,
      title,
      messages: JSON.stringify(messages),
    });

    return this.readHydrated(id);
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
    // Repository enforces owner-RBAC and throws 403/404 on miss.
    const conversation = await this.readHydrated(params.conversationId);
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

    this.logger.log(
      `appendMessage: id=${params.conversationId} userId=${params.userId} priorLen=${conversation.messages.length} newLen=${messages.length}`,
    );

    await this.conversationRepository.patch({
      id: params.conversationId,
      messages: JSON.stringify(messages),
    });

    const updated = await this.readHydrated(params.conversationId);
    return { conversation: updated, userMessage, assistantMessage, toolCalls };
  }

  async rename(params: { conversationId: string; title: string }): Promise<Conversation> {
    // readHydrated ensures owner-RBAC before we allow the update.
    await this.readHydrated(params.conversationId);
    await this.conversationRepository.patch({
      id: params.conversationId,
      title: params.title,
    });
    return this.readHydrated(params.conversationId);
  }

  async remove(params: { conversationId: string }): Promise<void> {
    await this.readHydrated(params.conversationId);
    await this.conversationRepository.delete({ id: params.conversationId });
  }

  async findById(params: { conversationId: string }): Promise<Conversation> {
    return this.readHydrated(params.conversationId);
  }

  async findAll(): Promise<Conversation[]> {
    const list = await this.conversationRepository.find({ fetchAll: true });
    return list.map((c) => this.hydrate(c));
  }

  /**
   * Read a conversation by id and hydrate the `messages` JSON field back to an array.
   * Repository.findById handles owner-RBAC (throws 403) and not-found (throws 404).
   */
  private async readHydrated(id: string): Promise<Conversation> {
    const entity = await this.conversationRepository.findById({ id });
    return this.hydrate(entity);
  }

  private hydrate(entity: Conversation): Conversation {
    const raw = entity.messages as unknown;
    let messages: ConversationMessage[] = [];
    if (Array.isArray(raw)) {
      messages = raw as ConversationMessage[];
    } else if (typeof raw === "string" && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) messages = parsed as ConversationMessage[];
      } catch (err) {
        this.logger.warn(`hydrate: failed to parse messages for conversation id=${entity.id} — using empty array`);
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
