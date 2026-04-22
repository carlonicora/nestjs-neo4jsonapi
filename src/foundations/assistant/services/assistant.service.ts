import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { ChatbotService } from "../../../agents/chatbot/services/chatbot.service";
import { GraphCatalogService } from "../../../agents/chatbot/services/graph.catalog.service";
import { UserModulesRepository } from "../../../agents/chatbot/repositories/user-modules.repository";
import { ChatbotReference, ChatbotToolCall } from "../../../agents/chatbot/interfaces/chatbot.response.interface";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
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
    private readonly graphCatalog: GraphCatalogService,
    private readonly entityServices: EntityServiceRegistry,
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
      assistantId,
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
      assistantId: params.assistantId,
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
      orderBy: "position DESC",
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
    assistantId?: string;
  }): Promise<AgentTurnResult> {
    const hydrationContent = await this.buildHydrationMessage(params.priorMessages, params.userModules);
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
      assistantId: params.assistantId,
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
   * Two-tier hydration:
   *   - Focus: full records re-read for every {type,id} referenced by the most
   *     recent assistant message.
   *   - Background: id + label stubs for references from earlier messages.
   * Returns null when there is nothing to hydrate. On any unexpected error
   * the whole builder returns null so a single bad Neo4j hiccup does not
   * fail the chat turn.
   */
  private async buildHydrationMessage(
    messages: AssistantMessage[],
    userModules: string[],
  ): Promise<string | null> {
    if (messages.length === 0) return null;
    try {
      const pairs = await this.assistantMessageRepo.findReferencedTypeIdPairs({
        messageIds: messages.map((m) => m.id),
      });
      if (pairs.length === 0) return null;

      // The most recent assistant message is the focus anchor.
      const prevAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

      // Partition references into focus (from previous assistant message) and
      // background (from any earlier message). Entity dedup on (type,id).
      const focusKeys = new Set<string>();
      const backgroundKeys = new Set<string>();
      const focusRefs: { type: string; id: string }[] = [];
      const backgroundRefs: { type: string; id: string }[] = [];
      for (const p of pairs) {
        const key = `${p.type}/${p.id}`;
        if (prevAssistantId && p.messageId === prevAssistantId) {
          if (!focusKeys.has(key)) {
            focusKeys.add(key);
            focusRefs.push({ type: p.type, id: p.id });
          }
        } else if (!backgroundKeys.has(key)) {
          backgroundKeys.add(key);
          backgroundRefs.push({ type: p.type, id: p.id });
        }
      }
      // Anything also in focus must not appear in background.
      const backgroundOnly = backgroundRefs.filter((b) => !focusKeys.has(`${b.type}/${b.id}`));

      // Size caps.
      const FOCUS_CAP = 25;
      const BACKGROUND_CAP = 100;
      const focusCapped = focusRefs.slice(0, FOCUS_CAP);
      if (focusRefs.length > FOCUS_CAP) {
        this.assistantLogger.warn(
          `buildHydrationMessage: focus set capped at ${FOCUS_CAP} (had ${focusRefs.length})`,
        );
      }
      const backgroundCapped = backgroundOnly.slice(0, BACKGROUND_CAP);
      if (backgroundOnly.length > BACKGROUND_CAP) {
        this.assistantLogger.warn(
          `buildHydrationMessage: background set capped at ${BACKGROUND_CAP} (had ${backgroundOnly.length})`,
        );
      }

      // Load focus records (full) and background records (project to label).
      const focusRecords = await this.loadFocusRecords(focusCapped, userModules);
      const backgroundStubs = await this.loadBackgroundStubs(backgroundCapped, userModules);

      if (focusRecords.length === 0 && backgroundStubs.length === 0) return null;

      const sections: string[] = ["## Entities already in this conversation", ""];
      if (focusRecords.length > 0) {
        sections.push("### Full records from the previous answer");
        sections.push(
          'These are the entities your previous answer was about. When the user\'s new question refers to any of them — by name or implicitly ("these", "them", "other orders", "their invoices") — use their id directly. Do not call search_entities for a name that matches one of these.',
        );
        sections.push("");
        sections.push(JSON.stringify(focusRecords, null, 2));
        sections.push("");
      }
      if (backgroundStubs.length > 0) {
        sections.push("### Other entities mentioned earlier in this conversation");
        sections.push(
          "These have been referenced in earlier turns. Recognise them if the user names them, and call read_entity(type, id) if you need their fields again.",
        );
        sections.push("");
        for (const s of backgroundStubs) {
          sections.push(s.label ? `- ${s.type}/${s.id} — "${s.label}"` : `- ${s.type}/${s.id}`);
        }
      }

      return sections.join("\n");
    } catch (err) {
      this.assistantLogger.warn(
        `buildHydrationMessage failed — proceeding without hydration: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async loadFocusRecords(
    refs: { type: string; id: string }[],
    userModules: string[],
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    for (const ref of refs) {
      // Per-type module gate. getEntityDetail returns null when the type is
      // not accessible to the current userModules.
      const detail = this.graphCatalog.getEntityDetail(ref.type, userModules);
      if (!detail) continue;
      const svc = this.entityServices.get(ref.type);
      if (!svc) continue;
      try {
        const record: any = await svc.findRecordById({ id: ref.id });
        if (!record) continue;
        out.push({ type: ref.type, ...record });
      } catch {
        // Deleted or RBAC-denied: drop silently.
        continue;
      }
    }
    return out;
  }

  private async loadBackgroundStubs(
    refs: { type: string; id: string }[],
    userModules: string[],
  ): Promise<Array<{ type: string; id: string; label?: string }>> {
    const out: Array<{ type: string; id: string; label?: string }> = [];
    for (const ref of refs) {
      const detail = this.graphCatalog.getEntityDetail(ref.type, userModules);
      if (!detail) continue;
      const labelField = detail.textSearchFields?.[0];
      const svc = this.entityServices.get(ref.type);
      if (!svc) continue;
      try {
        const record: any = await svc.findRecordById({ id: ref.id });
        if (!record) continue;
        const label = labelField ? (record[labelField] as string | undefined) : undefined;
        out.push({ type: ref.type, id: ref.id, ...(label ? { label } : {}) });
      } catch {
        continue;
      }
    }
    return out;
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
