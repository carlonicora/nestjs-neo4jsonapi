import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { ChatbotService } from "../../../agents/chatbot/services/chatbot.service";
import { UserModulesRepository } from "../../../agents/chatbot/repositories/user-modules.repository";
import { ChatbotToolCall } from "../../../agents/chatbot/interfaces/chatbot.response.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { Assistant, AssistantDescriptor, AssistantMessage } from "../entities/assistant";
import { assistantMeta } from "../entities/assistant.meta";
import { AssistantRepository } from "../repositories/assistant.repository";

/**
 * Maximum number of prior messages (turns) passed to the LLM on each turn.
 * Keeps prompt size and cost bounded for long conversations.
 */
export const MAX_MESSAGES_TO_LLM = 20;

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
 * Entities in `references` from prior turns are surfaced to the LLM as a
 * system-message "entity memory" hint so the agent can call `read_entity` directly
 * without having to re-search.
 *
 * NOTE on storage: Neo4j cannot store arbitrary objects as properties, so the
 * `messages` JSON array is stringified on write and parsed on read (see `hydrate`).
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
  ) {
    super(jsonApiService, assistantRepository, clsService, AssistantDescriptor.model);
  }

  async createWithFirstMessage(params: {
    companyId: string;
    userId: string;
    roles: string[];
    firstMessage: string;
    title?: string;
  }): Promise<{ assistant: Assistant; toolCalls: ChatbotToolCall[] }> {
    const userModules = await this.userModulesRepository.findModulesForRoles(params.roles);
    const title = params.title?.trim() || this.autoTitle(params.firstMessage);
    const now = new Date().toISOString();

    const userMessage: AssistantMessage = {
      id: randomUUID(),
      role: "user",
      content: params.firstMessage,
      createdAt: now,
    };

    const { assistantMessage, toolCalls } = await this.runAgentTurn({
      companyId: params.companyId,
      userId: params.userId,
      userModules,
      priorMessages: [],
      newUserMessage: userMessage,
    });

    const id = randomUUID();
    const messages = [userMessage, assistantMessage];

    this.assistantLogger.log(
      `createWithFirstMessage: id=${id} userId=${params.userId} companyId=${params.companyId} titleLength=${title.length} messages=${messages.length}`,
    );

    // Route the create through the descriptor-driven DTO pipeline so that
    // `contextKey: "userId"` on the `owner` relationship auto-attaches the
    // CREATED_BY edge from CLS. Calling `repository.create(...)` directly
    // would bypass that and leave the assistant ownerless — the owner-RBAC
    // check in `buildUserHasAccess` would then fail on the read-back.
    await this.createFromDTO({
      data: {
        type: assistantMeta.type,
        id,
        attributes: {
          title,
          messages: JSON.stringify(messages),
        },
      },
    });

    return { assistant: await this.loadHydrated(id), toolCalls };
  }

  async appendMessage(params: {
    assistantId: string;
    companyId: string;
    userId: string;
    roles: string[];
    newMessage: string;
  }): Promise<{
    assistant: Assistant;
    userMessage: AssistantMessage;
    assistantMessage: AssistantMessage;
    toolCalls: ChatbotToolCall[];
  }> {
    // Repository enforces owner-RBAC (via buildUserHasAccess) and throws 403/404 on miss.
    const assistant = await this.loadHydrated(params.assistantId);
    const userModules = await this.userModulesRepository.findModulesForRoles(params.roles);

    const userMessage: AssistantMessage = {
      id: randomUUID(),
      role: "user",
      content: params.newMessage,
      createdAt: new Date().toISOString(),
    };

    const { assistantMessage, toolCalls } = await this.runAgentTurn({
      companyId: params.companyId,
      userId: params.userId,
      userModules,
      priorMessages: assistant.messages,
      newUserMessage: userMessage,
    });

    const messages = [...assistant.messages, userMessage, assistantMessage];

    this.assistantLogger.log(
      `appendMessage: id=${params.assistantId} userId=${params.userId} priorLen=${assistant.messages.length} newLen=${messages.length}`,
    );

    await this.repository.patch({
      id: params.assistantId,
      messages: JSON.stringify(messages),
    });

    const updated = await this.loadHydrated(params.assistantId);
    return { assistant: updated, userMessage, assistantMessage, toolCalls };
  }

  /**
   * Load a typed Assistant with its `messages` JSON hydrated to an array.
   *
   * Uses the inherited typed read via the repository directly (bypasses JSON:API
   * serialisation) — callers that need JSON:API responses should go through
   * `findById` which the framework wires through createCrudHandlers.
   */
  private async loadHydrated(id: string): Promise<Assistant> {
    const entity = await this.repository.findById({ id });
    return this.hydrate(entity);
  }

  /**
   * Parse `messages` JSON string back to an array. Handles the case where
   * the driver already returned a parsed array (e.g. during tests) as well as
   * empty/malformed strings defensively.
   */
  private hydrate(entity: Assistant): Assistant {
    const raw = entity.messages as unknown;
    let messages: AssistantMessage[] = [];
    if (Array.isArray(raw)) {
      messages = raw as AssistantMessage[];
    } else if (typeof raw === "string" && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) messages = parsed as AssistantMessage[];
      } catch {
        this.assistantLogger.warn(
          `hydrate: failed to parse messages for assistant id=${entity.id} — using empty array`,
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
    priorMessages: AssistantMessage[];
    newUserMessage: AssistantMessage;
  }): Promise<{ assistantMessage: AssistantMessage; toolCalls: ChatbotToolCall[] }> {
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

    const assistantMessage: AssistantMessage = {
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
  private buildHydrationMessage(messages: AssistantMessage[]): string | null {
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
