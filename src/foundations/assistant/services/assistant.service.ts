import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { OPERATOR_DEFAULT_APPROVAL_TTL_DAYS } from "../../../agents/operator/services/operator.checkpointer.service";
import { OperatorRunResult, OperatorService } from "../../../agents/operator/services/operator.service";
import { ResponderService } from "../../../agents/responder/services/responder.service";
import { GraphCatalogService } from "../../../agents/graph/services/graph.catalog.service";
import { ScopeGuard } from "../../../agents/graph/services/scope.guard";
import { UserModulesRepository } from "../../../agents/graph/repositories/user-modules.repository";
import { EntityReference } from "../../../agents/responder/interfaces/entity.reference.interface";
import type { ToolCallRecord, UserContext } from "../../../agents/graph/tools/tool.factory";
import type { UnifiedTrace } from "../../../agents/responder/interfaces/unified.trace.interface";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigOperatorInterface } from "../../../config/interfaces/config.operator.interface";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { AssistantAction, AssistantActionStatus } from "../../assistant-action/entities/assistant-action";
import { AssistantActionRepository } from "../../assistant-action/repositories/assistant-action.repository";
import { AssistantActionService } from "../../assistant-action/services/assistant-action.service";
import { AssistantMessage, AssistantMessageDescriptor } from "../../assistant-message/entities/assistant-message";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { AssistantMessageRepository } from "../../assistant-message/repositories/assistant-message.repository";
import { AssistantMessageService } from "../../assistant-message/services/assistant-message.service";
import { Assistant, AssistantDescriptor } from "../entities/assistant";
import { assistantMeta } from "../entities/assistant.meta";
import { modelRegistry } from "../../../common/registries/registry";
import { AssistantRepository } from "../repositories/assistant.repository";
import { AssistantMentionExtractor, ExtractedMention } from "./assistant-mention.extractor";

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
  references: EntityReference[];
  sources: { chunkId: string; relevance: number; reason: string }[];
  suggestedQuestions: string[];
  tokens: { input: number; output: number };
  toolCalls: ToolCallRecord[];
  trace: UnifiedTrace;
}

/**
 * AssistantService
 *
 * Wraps the stateless ResponderService.run() in a stateful lifecycle. Extends
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
    private readonly userModuleIdsRepository: UserModulesRepository,
    private readonly responder: ResponderService,
    private readonly assistantMessages: AssistantMessageService,
    private readonly assistantMessageRepo: AssistantMessageRepository,
    private readonly graphCatalog: GraphCatalogService,
    private readonly entityServices: EntityServiceRegistry,
    private readonly operator: OperatorService,
    private readonly assistantActions: AssistantActionService,
    private readonly assistantActionRepo: AssistantActionRepository,
    private readonly webSocketService: WebSocketService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    private readonly mentions: AssistantMentionExtractor,
    private readonly blockNote: BlockNoteService,
    private readonly scopeGuard: ScopeGuard,
  ) {
    super(jsonApiService, assistantRepository, clsService, AssistantDescriptor.model);
  }

  async createWithFirstMessage(params: {
    companyId: string;
    userId: string;
    firstMessage: string;
    title?: string;
    howToMode?: boolean;
    limitToHowToId?: string;
    boundContent?: { type: string; id: string };
  }): Promise<{
    assistant: Assistant;
    userMessage: AssistantMessage;
    assistantMessage: AssistantMessage;
    toolCalls: ToolCallRecord[];
  }> {
    const userModuleIds = await this.userModuleIdsRepository.findModuleIdsForUser(params.userId);
    const ctx = this.buildTurnContext({
      companyId: params.companyId,
      userId: params.userId,
      userModuleIds,
      boundContent: params.boundContent,
    });
    const {
      content: firstMessage,
      plainText,
      pinned,
    } = await this.resolveUserTurnInput({
      rawContent: params.firstMessage,
      ctx,
    });
    const title = params.title?.trim() || this.autoTitle(plainText);

    const assistantId = randomUUID();
    const userMessageId = randomUUID();

    // 1. Create the Assistant (owner edge attached from CLS via contextKey).
    //    A bound thread also gets the BOUND_TO edge to the resource it is
    //    confined to — the relationship is immutable, so it is set on create.
    await this.createFromDTO({
      data: {
        type: assistantMeta.type,
        id: assistantId,
        attributes: { title },
      },
    });
    await this.attachBoundContent(assistantId, params.boundContent);

    // 2. Create the first user message at position 0.
    await this.assistantMessages.createFromDTO({
      data: {
        type: assistantMessageMeta.type,
        id: userMessageId,
        attributes: {
          role: "user",
          content: firstMessage,
          position: 0,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: assistantId } },
        },
      },
    });
    await this.linkPinnedMentions({ messageId: userMessageId, pinned });
    const userMessage = await this.assistantMessageRepo.findById({ id: userMessageId });

    // 3. Run the agent turn using the just-created user message as context.
    const turn = await this.runAgentTurn({
      ctx,
      priorMessages: [],
      newUserMessage: { role: "user", content: firstMessage },
      pinned,
      assistantId,
      contentScope: this.toContentScope(params.boundContent),
      howToMode: params.howToMode,
      limitToHowToId: params.limitToHowToId,
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
    if (turn.sources.length) {
      await this.assistantMessageRepo.linkCitations({
        messageId: assistantMessageId,
        citations: turn.sources.map((s) => ({ chunkId: s.chunkId, relevance: s.relevance, reason: s.reason })),
      });
    }
    await this.assistantMessageRepo.setTrace({
      messageId: assistantMessageId,
      trace: JSON.stringify(turn.trace),
    });
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
    newMessage: string;
    howToMode?: boolean;
    limitToHowToId?: string;
  }): Promise<{
    userMessage: AssistantMessage;
    assistantMessage: AssistantMessage;
    toolCalls: ToolCallRecord[];
  }> {
    // Verify ownership via the owner-RBAC-enforcing findById.
    await this.repository.findById({ id: params.assistantId });
    const userModuleIds = await this.userModuleIdsRepository.findModuleIdsForUser(params.userId);

    // An append inherits the thread's binding — never a client-supplied one.
    const contentScope = await this.resolveContentScope(params.assistantId);
    const ctx = this.buildTurnContext({
      companyId: params.companyId,
      userId: params.userId,
      userModuleIds,
      boundContent: this.toBoundContent(contentScope),
    });
    const { content: newMessage, pinned } = await this.resolveUserTurnInput({
      rawContent: params.newMessage,
      ctx,
    });

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
          content: newMessage,
          position: nextPosition,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: params.assistantId } },
        },
      },
    });
    await this.linkPinnedMentions({ messageId: userMessageId, pinned });
    const userMessage = await this.assistantMessageRepo.findById({ id: userMessageId });

    const turn = await this.runAgentTurn({
      ctx,
      priorMessages,
      newUserMessage: { role: "user", content: newMessage },
      pinned,
      assistantId: params.assistantId,
      contentScope,
      howToMode: params.howToMode,
      limitToHowToId: params.limitToHowToId,
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
    if (turn.sources.length) {
      await this.assistantMessageRepo.linkCitations({
        messageId: assistantMessageId,
        citations: turn.sources.map((s) => ({ chunkId: s.chunkId, relevance: s.relevance, reason: s.reason })),
      });
    }
    await this.assistantMessageRepo.setTrace({
      messageId: assistantMessageId,
      trace: JSON.stringify(turn.trace),
    });
    const assistantMessage = await this.assistantMessageRepo.findById({ id: assistantMessageId });

    this.assistantLogger.log(
      `appendMessage: id=${params.assistantId} userId=${params.userId} newPos=${nextPosition}-${nextPosition + 1}`,
    );

    return { userMessage, assistantMessage, toolCalls: turn.toolCalls };
  }

  /**
   * Operator variant of `createWithFirstMessage`: same persistence lifecycle
   * (assistant node, user message at position 0, assistant turn at position 1)
   * but the turn runs on the checkpointed OperatorService instead of the
   * stateless responder. A `pending_approval` outcome freezes the run and
   * materialises an AssistantAction + an `approval-request` assistant message.
   */
  async createWithFirstMessageOperator(params: {
    companyId: string;
    userId: string;
    firstMessage: string;
    title?: string;
    howToMode?: boolean;
    limitToHowToId?: string;
    boundContent?: { type: string; id: string };
  }): Promise<{
    assistant: Assistant;
    userMessage: AssistantMessage;
    assistantMessage: AssistantMessage;
    toolCalls: ToolCallRecord[];
    action?: AssistantAction;
  }> {
    const userModuleIds = await this.userModuleIdsRepository.findModuleIdsForUser(params.userId);
    const ctx = this.buildTurnContext({
      companyId: params.companyId,
      userId: params.userId,
      userModuleIds,
      boundContent: params.boundContent,
    });
    const {
      content: firstMessage,
      plainText,
      pinned,
    } = await this.resolveUserTurnInput({
      rawContent: params.firstMessage,
      ctx,
    });
    const title = params.title?.trim() || this.autoTitle(plainText);

    const assistantId = randomUUID();
    const userMessageId = randomUUID();

    // Persist the engine marker so clients can route follow-up turns to the
    // operator endpoints after a reload — absence means responder semantics.
    await this.createFromDTO({
      data: {
        type: assistantMeta.type,
        id: assistantId,
        attributes: { title, engine: "operator" },
        ...(params.boundContent
          ? {
              relationships: {
                content: { data: { type: params.boundContent.type, id: params.boundContent.id } },
              },
            }
          : {}),
      },
    });

    await this.assistantMessages.createFromDTO({
      data: {
        type: assistantMessageMeta.type,
        id: userMessageId,
        attributes: {
          role: "user",
          content: firstMessage,
          position: 0,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: assistantId } },
        },
      },
    });
    await this.linkPinnedMentions({ messageId: userMessageId, pinned });
    const userMessage = await this.assistantMessageRepo.findById({ id: userMessageId });

    const threadId = `${assistantId}:${userMessageId}`;
    const contentScope = this.toContentScope(params.boundContent);
    const result = await this.runOperatorTurn({
      ctx,
      priorMessages: [],
      question: firstMessage,
      pinned,
      assistantId,
      threadId,
      contentScope,
    });

    const outcome = await this.persistOperatorOutcome({
      assistantId,
      threadId,
      userModuleIds,
      contentScope,
      result,
      position: 1,
    });

    this.assistantLogger.log(
      `createWithFirstMessageOperator: id=${assistantId} userId=${params.userId} companyId=${params.companyId} outcome=${result.kind}`,
    );

    const assistant = await this.repository.findById({ id: assistantId });
    return { assistant, userMessage, ...outcome };
  }

  /**
   * Operator variant of `appendMessage`: identical hydration, history trim and
   * persistence shape, but the turn runs on the checkpointed OperatorService.
   */
  async appendMessageOperator(params: {
    assistantId: string;
    companyId: string;
    userId: string;
    newMessage: string;
    howToMode?: boolean;
    limitToHowToId?: string;
  }): Promise<{
    userMessage: AssistantMessage;
    assistantMessage: AssistantMessage;
    toolCalls: ToolCallRecord[];
    action?: AssistantAction;
  }> {
    // Verify ownership via the owner-RBAC-enforcing findById.
    await this.repository.findById({ id: params.assistantId });
    const userModuleIds = await this.userModuleIdsRepository.findModuleIdsForUser(params.userId);

    const contentScope = await this.resolveContentScope(params.assistantId);
    const ctx = this.buildTurnContext({
      companyId: params.companyId,
      userId: params.userId,
      userModuleIds,
      boundContent: this.toBoundContent(contentScope),
    });
    const { content: newMessage, pinned } = await this.resolveUserTurnInput({
      rawContent: params.newMessage,
      ctx,
    });

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
          content: newMessage,
          position: nextPosition,
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: params.assistantId } },
        },
      },
    });
    await this.linkPinnedMentions({ messageId: userMessageId, pinned });
    const userMessage = await this.assistantMessageRepo.findById({ id: userMessageId });

    const threadId = `${params.assistantId}:${userMessageId}`;
    const result = await this.runOperatorTurn({
      ctx,
      priorMessages,
      question: newMessage,
      pinned,
      assistantId: params.assistantId,
      threadId,
      contentScope,
    });

    const outcome = await this.persistOperatorOutcome({
      assistantId: params.assistantId,
      threadId,
      userModuleIds,
      contentScope,
      result,
      position: nextPosition + 1,
    });

    this.assistantLogger.log(
      `appendMessageOperator: id=${params.assistantId} userId=${params.userId} newPos=${nextPosition}-${nextPosition + 1} outcome=${result.kind}`,
    );

    return { userMessage, ...outcome };
  }

  /**
   * Approve or deny a pending AssistantAction and resume the frozen operator
   * run. The status transition is guarded atomically in Cypher
   * (`resolveStatus`) BEFORE the resume so a double approve/deny loses with a
   * 409 and never re-executes the tool. The final assistant message is
   * appended at the current end of the thread (chatting may have continued)
   * and pushed over the websocket so any open chat updates live.
   */
  async resolveAction(params: { actionId: string; approved: boolean }): Promise<{
    assistantMessage: AssistantMessage;
    action: AssistantAction;
  }> {
    const action = await this.assistantActionRepo.findById({ id: params.actionId });
    const resolvedTo: AssistantActionStatus = params.approved ? "approved" : "denied";

    const transitioned = await this.assistantActionRepo.resolveStatus({
      id: params.actionId,
      from: "pending",
      to: resolvedTo,
    });
    if (!transitioned) {
      throw new ConflictException("This action has already been resolved or has expired.");
    }

    const [assistantId] = action.threadId.split(":");
    const userId = this.clsService.get("userId");
    const companyId = action.company?.id ?? this.clsService.get("companyId");

    // Stored fields are JSON strings persisted by us, but a corrupt value must
    // not turn an approval into an unrecoverable 500 — default and proceed.
    let userModuleIds: string[] = [];
    try {
      userModuleIds = action.userModuleIds ? JSON.parse(action.userModuleIds) : [];
    } catch {
      this.assistantLogger.warn(
        `resolveAction: corrupt userModuleIds JSON on action=${params.actionId} — defaulting to []`,
      );
    }
    let contentScope: { contentId?: string; contentType?: string } | undefined;
    try {
      contentScope = action.contentScope ? JSON.parse(action.contentScope) : undefined;
    } catch {
      this.assistantLogger.warn(
        `resolveAction: corrupt contentScope JSON on action=${params.actionId} — proceeding without content scope`,
      );
    }

    // Rebuild the resume context the same way appendMessageOperator builds the
    // run context: the thread's recent messages, trimmed to MAX_MESSAGES_TO_LLM.
    const priorMessages = await this.loadRecentMessages({ assistantId, limit: MAX_MESSAGES_TO_LLM });
    const messages: MessageInterface[] = priorMessages.slice(-MAX_MESSAGES_TO_LLM).map((m) => ({
      type: this.roleToType(m.role),
      content: m.content,
    }));

    let result: OperatorRunResult;
    try {
      result = await this.operator.resume({
        threadId: action.threadId,
        approved: params.approved,
        companyId,
        userId,
        userModuleIds,
        contentId: contentScope?.contentId,
        contentType: contentScope?.contentType,
        messages,
      });
    } catch (err) {
      // Expired or missing checkpoint (or any resume failure): the action can
      // never complete — mark it failed and surface a clear 409 (spec §4).
      await this.assistantActionRepo.resolveStatus({ id: params.actionId, from: resolvedTo, to: "failed" });
      this.assistantLogger.error(
        `resolveAction: resume failed for action=${params.actionId} thread=${action.threadId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ConflictException("Could not resume this action — please ask again.");
    }

    // Approved + resumed successfully → the destructive tool ran: executed.
    // The truth of "executed" is the resume returning, NOT message persistence
    // — transition immediately so the status never lies if persistence fails.
    // Denied stays `denied` (set by the guard above).
    if (params.approved) {
      await this.assistantActionRepo.resolveStatus({ id: params.actionId, from: "approved", to: "executed" });
    }

    let outcome: { assistantMessage: AssistantMessage; toolCalls: ToolCallRecord[]; action?: AssistantAction };
    try {
      const nextPosition = await this.assistantMessageRepo.getNextPosition({ assistantId });
      outcome = await this.persistOperatorOutcome({
        assistantId,
        threadId: action.threadId,
        userModuleIds,
        contentScope,
        result,
        position: nextPosition,
      });
    } catch (err) {
      // The tool already ran and the action is correctly `executed`; the answer
      // could not be persisted. Log the orphaned answer so it is recoverable.
      this.assistantLogger.error(
        `resolveAction: action=${params.actionId} executed but persisting the answer failed — orphaned operator result: ${JSON.stringify(result)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
    const updatedAction = await this.assistantActionRepo.findById({ id: params.actionId });

    // Live update for any open chat on this thread — best-effort: a transport
    // hiccup must not fail a request whose action executed and persisted.
    try {
      const document = await this.jsonApiService.buildSingle(
        AssistantMessageDescriptor.model,
        outcome.assistantMessage,
      );
      await this.webSocketService.sendMessageToUser(userId, "assistant:message", document);
    } catch (err) {
      this.assistantLogger.warn(
        `resolveAction: websocket push failed for action=${params.actionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.assistantLogger.log(
      `resolveAction: action=${params.actionId} approved=${params.approved} outcome=${result.kind}`,
    );

    // A resumed run can freeze again on a further destructive call: the new
    // pending action supersedes the (now executed) original in the response.
    return { assistantMessage: outcome.assistantMessage, action: outcome.action ?? updatedAction };
  }

  /**
   * List the threads bound to one resource (e.g. every assistant thread for a
   * campaign). Delegates to the inherited `findByRelated` over the `content`
   * relationship — the BOUND_TO traversal already exists, so there is no new
   * Cypher here and company/owner RBAC still comes from the repository.
   */
  async findByBoundContent(params: { boundType: string; boundId: string; query: any }): Promise<JsonApiDataInterface> {
    const model = modelRegistry.getByType(params.boundType);
    if (!model) {
      throw new BadRequestException(`Unknown resource type "${params.boundType}" for boundType.`);
    }

    const paginator = new JsonApiPaginator(params.query);
    // `findByRelatedEdge`, not `findByRelated`: the latter derives the target
    // label from `relationships.content.model`, which for this polymorphic edge
    // is the `assistantMeta` placeholder, so it would look for
    // `(:Assistant { id: <campaign-uuid> })` and always return nothing. This
    // variant takes the edge spec explicitly, with the label resolved from the
    // model registry.
    const data = await this.repository.findByRelatedEdge({
      cypherLabel: "BOUND_TO",
      cypherDirection: "out",
      relatedLabel: model.labelName,
      relatedId: params.boundId,
      cursor: paginator.generateCursor(),
    });

    return this.jsonApiService.buildList(AssistantDescriptor.model, data, paginator);
  }

  /**
   * Build the run's UserContext once per turn. `scopeId`/`scopeType` are set
   * only when the thread is bound to a catalogued scope ROOT (a descriptor
   * whose compiled scope chain is empty, e.g. a campaign). A thread bound to
   * something further down a chain still gets content scope, but not a
   * transitive run scope — the guard has no root to confine the run to.
   */
  private buildTurnContext(params: {
    companyId: string;
    userId: string;
    userModuleIds: string[];
    boundContent?: { type: string; id: string };
  }): UserContext {
    const ctx: UserContext = {
      companyId: params.companyId,
      userId: params.userId,
      userModuleIds: params.userModuleIds,
    };

    const bound = params.boundContent;
    if (!bound?.type || !bound?.id) return ctx;

    const scope = this.graphCatalog.getEntityDetail(bound.type, params.userModuleIds)?.scope;
    if (scope && scope.path.length === 0 && scope.rootType === bound.type) {
      ctx.scopeId = bound.id;
      ctx.scopeType = bound.type;
    } else {
      this.assistantLogger.warn(
        `buildTurnContext: bound type "${bound.type}" is not a catalogued scope root — the turn runs unscoped.`,
      );
    }
    return ctx;
  }

  /**
   * Write the `BOUND_TO` edge that scopes a thread to a resource.
   *
   * Deliberately NOT part of the `createFromDTO` call above: `BOUND_TO` is
   * polymorphic, so its descriptor entry carries `assistantMeta` as a
   * placeholder model. The generic create path reads `rel.model.labelName` to
   * validate the target and to build the edge, so a Campaign id sent that way
   * is looked up as `(:Assistant { id: … })` and 400s with "One or more
   * related nodes do not exist."
   *
   * The label is resolved from the model registry — the same registry the
   * descriptor's own polymorphic discriminator uses on the read path — so an
   * unregistered type fails loudly here rather than writing a dangling edge.
   */
  private async attachBoundContent(assistantId: string, boundContent?: { type: string; id: string }): Promise<void> {
    if (!boundContent) return;

    const model = modelRegistry.getByType(boundContent.type);
    if (!model) {
      throw new BadRequestException(`Unknown resource type "${boundContent.type}" for the assistant's bound content.`);
    }

    await (this.repository as AssistantRepository).bindContent({
      assistantId,
      targetLabel: model.labelName,
      targetId: boundContent.id,
    });
  }

  private toContentScope(boundContent?: { type: string; id: string }): {
    contentId?: string;
    contentType?: string;
  } {
    return boundContent ? { contentId: boundContent.id, contentType: boundContent.type } : {};
  }

  private toBoundContent(contentScope: {
    contentId?: string;
    contentType?: string;
  }): { type: string; id: string } | undefined {
    return contentScope.contentId && contentScope.contentType
      ? { type: contentScope.contentType, id: contentScope.contentId }
      : undefined;
  }

  /**
   * A BlockNote-backed field arrives as a JSON string in its own string
   * attribute — the convention every host-app entity already uses (e.g.
   * `Npc.description`: `JSON.stringify` out, `JSON.parse` back). Detect that
   * shape without trusting it: a plain-text message must never be mistaken for
   * a document, so this requires an array whose first entry is an object with
   * a string `type`, which is the minimal shape of a BlockNote block.
   */
  private parseBlockNoteDocument(raw: string): unknown[] | null {
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("[")) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      const first = parsed[0] as { type?: unknown } | null;
      if (!first || typeof first !== "object" || typeof first.type !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Derive from a user message: the markdown to persist (mention links kept, so
   * the thread can re-render them), a plain-text form for the thread title, and
   * the validated entity mentions to pin into the turn's focus context.
   *
   * Plain-text input passes straight through, so apps without a rich composer
   * are unaffected.
   */
  private async resolveUserTurnInput(params: {
    rawContent: string;
    ctx: UserContext;
  }): Promise<{ content: string; plainText: string; pinned: ExtractedMention[] }> {
    const nodes = this.parseBlockNoteDocument(params.rawContent);
    if (!nodes) return { content: params.rawContent, plainText: params.rawContent, pinned: [] };

    const content = this.blockNote.convertToMarkdown({ nodes, preserveMentions: true });
    // Alias-only rendering: what a human reads. Used for the thread title so it
    // does not show raw `[Name](mention://npcs/<uuid>)` markup.
    const plainText = this.blockNote.convertToMarkdown({ nodes });
    const pinned = await this.mentions.validate({
      mentions: this.mentions.extract(nodes),
      ctx: params.ctx,
    });
    return { content, plainText, pinned };
  }

  /**
   * Materialise REFERENCES edges from the USER message to the entities that
   * message named. The reference metadata is fixed: a mention is an explicit,
   * maximally relevant pointer, not a ranked retrieval hit.
   */
  private async linkPinnedMentions(params: { messageId: string; pinned: ExtractedMention[] }): Promise<void> {
    if (!params.pinned.length) return;
    const references: EntityReference[] = params.pinned.map((mention) => ({
      type: mention.type,
      id: mention.id,
      relevance: 100,
      reason: "Named explicitly by the user in this message.",
    }));
    await this.assistantMessageRepo.linkReferences({ messageId: params.messageId, references });
  }

  /**
   * Drop records that fall outside the run's scope root, grouping by JSON:API
   * type so `ScopeGuard` can build one predicate per type. A no-op for an
   * unscoped run — `ScopeGuard.filter` returns everything in that case, so the
   * short-circuit only avoids a pointless round trip.
   */
  private async filterByScope<T extends Record<string, unknown>>(records: T[], ctx: UserContext): Promise<T[]> {
    if (!ctx.scopeId || !ctx.scopeType || records.length === 0) return records;

    const byType = new Map<string, Array<T & { id: string }>>();
    for (const record of records) {
      const type = typeof record.type === "string" ? record.type : undefined;
      const id = typeof record.id === "string" ? record.id : undefined;
      if (!type || !id) continue;
      const bucket = byType.get(type) ?? [];
      bucket.push(record as T & { id: string });
      byType.set(type, bucket);
    }

    const kept = new Set<T>();
    for (const [type, bucket] of byType) {
      const allowed = await this.scopeGuard.filter({ type, records: bucket, ctx });
      for (const record of allowed) kept.add(record);
    }
    return records.filter((record) => kept.has(record));
  }

  /**
   * Resolve the content scope from the assistant's BOUND_TO relationship if
   * loaded.
   */
  private async resolveContentScope(assistantId: string): Promise<{ contentId?: string; contentType?: string }> {
    try {
      const assistant = await this.repository.findById({ id: assistantId });
      const c = (assistant as any).content;
      return { contentId: c?.id, contentType: c?.type };
    } catch {
      // If load fails, proceed without content scope.
      return {};
    }
  }

  /**
   * Runs a single operator turn. Builds the exact message list the responder
   * path builds ([hydration system message?, ...trimmed priors, question])
   * and invokes the checkpointed operator graph under `threadId`.
   */
  private async runOperatorTurn(params: {
    ctx: UserContext;
    priorMessages: AssistantMessage[];
    question: string;
    pinned: ExtractedMention[];
    assistantId: string;
    threadId: string;
    contentScope: { contentId?: string; contentType?: string };
  }): Promise<OperatorRunResult> {
    const now = new Date();
    this.clsService.set("assistantTurnContext", {
      assistantId: params.assistantId,
      turnStartedAt: now.toISOString().slice(0, 19).replace(/[T:]/g, "-"),
    });

    const hydrationContent = await this.buildHydrationMessage(params.priorMessages, params.ctx, params.pinned);

    const trimmed = params.priorMessages.slice(-MAX_MESSAGES_TO_LLM).map((m) => ({
      type: this.roleToType(m.role),
      content: m.content,
    }));

    const messages: MessageInterface[] = [
      ...(hydrationContent ? [{ type: AgentMessageType.System, content: hydrationContent }] : []),
      ...trimmed,
      { type: AgentMessageType.User, content: params.question },
    ];

    return await this.operator.run({
      companyId: params.ctx.companyId,
      userId: params.ctx.userId,
      userModuleIds: params.ctx.userModuleIds,
      contentId: params.contentScope.contentId,
      contentType: params.contentScope.contentType,
      scopeId: params.ctx.scopeId,
      scopeType: params.ctx.scopeType,
      messages,
      question: params.question,
      threadId: params.threadId,
    });
  }

  /**
   * Persist the outcome of an operator turn (initial run or resume).
   *
   * - `completed` → assistant message + REFERENCES/CITES edges, exactly like
   *   the responder path (the operator result carries no UnifiedTrace, so
   *   `setTrace` is not called).
   * - `pending_approval` → an `approval-request` assistant message carrying
   *   the human-readable summary, plus a `pending` AssistantAction linked to
   *   it, expiring after `operator.approvalTtlDays` from app config (default 7).
   */
  private async persistOperatorOutcome(params: {
    assistantId: string;
    threadId: string;
    userModuleIds: string[];
    contentScope?: { contentId?: string; contentType?: string };
    result: OperatorRunResult;
    position: number;
  }): Promise<{ assistantMessage: AssistantMessage; toolCalls: ToolCallRecord[]; action?: AssistantAction }> {
    const assistantMessageId = randomUUID();

    if (params.result.kind === "completed") {
      const { result } = params;
      await this.assistantMessages.createFromDTO({
        data: {
          type: assistantMessageMeta.type,
          id: assistantMessageId,
          attributes: {
            role: "assistant",
            content: result.answer,
            position: params.position,
            suggestedQuestions: result.questions,
            inputTokens: result.tokens.input,
            outputTokens: result.tokens.output,
          },
          relationships: {
            assistant: { data: { type: assistantMeta.type, id: params.assistantId } },
          },
        },
      });

      if (result.references.length) {
        await this.assistantMessageRepo.linkReferences({
          messageId: assistantMessageId,
          references: result.references,
        });
      }
      if (result.citations.length) {
        await this.assistantMessageRepo.linkCitations({
          messageId: assistantMessageId,
          citations: result.citations.map((c) => ({ chunkId: c.chunkId, relevance: c.relevance, reason: c.reason })),
        });
      }
      const assistantMessage = await this.assistantMessageRepo.findById({ id: assistantMessageId });
      return { assistantMessage, toolCalls: result.toolCalls };
    }

    // pending_approval — freeze: approval-request message + pending action.
    const { result } = params;
    await this.assistantMessages.createFromDTO({
      data: {
        type: assistantMessageMeta.type,
        id: assistantMessageId,
        attributes: {
          role: "assistant",
          content: result.summary,
          position: params.position,
          messageType: "approval-request",
        },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: params.assistantId } },
        },
      },
    });
    const assistantMessage = await this.assistantMessageRepo.findById({ id: assistantMessageId });

    const ttlDays =
      this.configService.get<ConfigOperatorInterface>("operator")?.approvalTtlDays ??
      OPERATOR_DEFAULT_APPROVAL_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const hasContentScope = !!(params.contentScope?.contentId || params.contentScope?.contentType);

    const action = await this.assistantActions.createPendingAction({
      toolName: result.toolName,
      toolArgs: JSON.stringify(result.toolArgs),
      summary: result.summary,
      threadId: params.threadId,
      userModuleIds: JSON.stringify(params.userModuleIds),
      ...(hasContentScope ? { contentScope: JSON.stringify(params.contentScope) } : {}),
      expiresAt,
      assistantId: params.assistantId,
      messageId: assistantMessageId,
    });

    return { assistantMessage, toolCalls: [], action };
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
   * and invokes the unified responder. Returns the assistant reply metadata.
   */
  private async runAgentTurn(params: {
    ctx: UserContext;
    priorMessages: AssistantMessage[];
    newUserMessage: { role: "user"; content: string };
    pinned: ExtractedMention[];
    assistantId?: string;
    contentScope: { contentId?: string; contentType?: string };
    howToMode?: boolean;
    limitToHowToId?: string;
  }): Promise<AgentTurnResult> {
    // Anchor every LLMService.call() in this turn to the same assistant/turn
    // pair so the dumper can group dumps under
    // .llm-dumps/<date>/<assistantId>/<turn-time>/.
    if (params.assistantId) {
      const now = new Date();
      this.clsService.set("assistantTurnContext", {
        assistantId: params.assistantId,
        turnStartedAt: now.toISOString().slice(0, 19).replace(/[T:]/g, "-"),
      });
    }

    const hydrationContent = await this.buildHydrationMessage(params.priorMessages, params.ctx, params.pinned);

    const trimmed = params.priorMessages.slice(-MAX_MESSAGES_TO_LLM).map((m) => ({
      type: this.roleToType(m.role),
      content: m.content,
    }));

    const messages: MessageInterface[] = [
      ...(hydrationContent ? [{ type: AgentMessageType.System, content: hydrationContent }] : []),
      ...trimmed,
      { type: AgentMessageType.User, content: params.newUserMessage.content },
    ];

    const response = await this.responder.run({
      companyId: params.ctx.companyId,
      userId: params.ctx.userId,
      userModuleIds: params.ctx.userModuleIds,
      contentId: params.contentScope.contentId,
      contentType: params.contentScope.contentType,
      scopeId: params.ctx.scopeId,
      scopeType: params.ctx.scopeType,
      dataLimits: {
        howToMode: params.howToMode,
        limitToHowToId: params.limitToHowToId,
      },
      messages,
      question: params.newUserMessage.content,
    });

    return {
      id: randomUUID(),
      role: "assistant",
      content: response.answer.answer,
      createdAt: new Date().toISOString(),
      references: response.references ?? [],
      sources: response.sources ?? [],
      suggestedQuestions: response.answer?.questions ?? [],
      tokens: response.tokens ?? { input: 0, output: 0 },
      toolCalls: response.graphContext?.toolCalls ?? [],
      trace: response.trace,
    };
  }

  private roleToType(role: "user" | "assistant" | "system"): AgentMessageType {
    switch (role) {
      case "user":
        return AgentMessageType.User;
      case "assistant":
        return AgentMessageType.Assistant;
      case "system":
        return AgentMessageType.System;
    }
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
    ctx: UserContext,
    pinned: ExtractedMention[] = [],
  ): Promise<string | null> {
    if (messages.length === 0 && pinned.length === 0) return null;
    try {
      const userModuleIds = ctx.userModuleIds;
      const pairs = messages.length
        ? await this.assistantMessageRepo.findReferencedTypeIdPairs({
            messageIds: messages.map((m) => m.id),
          })
        : [];
      if (pairs.length === 0 && pinned.length === 0) return null;

      // The most recent assistant message is the focus anchor.
      const prevAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

      // Partition references into focus (from previous assistant message) and
      // background (from any earlier message). Entity dedup on (type,id).
      const focusKeys = new Set<string>();
      const backgroundKeys = new Set<string>();
      const focusRefs: { type: string; id: string }[] = [];
      const backgroundRefs: { type: string; id: string }[] = [];

      // Entities the user named explicitly lead the focus tier: they are the
      // subject of the new question, so they must survive FOCUS_CAP and must
      // never be demoted to a background stub by an earlier mention.
      for (const mention of pinned) {
        const key = `${mention.type}/${mention.id}`;
        if (focusKeys.has(key)) continue;
        focusKeys.add(key);
        focusRefs.push({ type: mention.type, id: mention.id });
      }

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
        this.assistantLogger.warn(`buildHydrationMessage: focus set capped at ${FOCUS_CAP} (had ${focusRefs.length})`);
      }
      const backgroundCapped = backgroundOnly.slice(0, BACKGROUND_CAP);
      if (backgroundOnly.length > BACKGROUND_CAP) {
        this.assistantLogger.warn(
          `buildHydrationMessage: background set capped at ${BACKGROUND_CAP} (had ${backgroundOnly.length})`,
        );
      }

      // Load focus records (full) and background records (project to label),
      // then drop anything outside the run's scope. Hydration is a data-access
      // point like any tool: a record from another campaign must never reach
      // the LLM just because an earlier turn referenced it.
      const focusRecords = await this.filterByScope(await this.loadFocusRecords(focusCapped, userModuleIds), ctx);
      const backgroundStubs = await this.filterByScope(
        await this.loadBackgroundStubs(backgroundCapped, userModuleIds),
        ctx,
      );

      // Diagnostic trace: in the dump it lets us see exactly which entities were
      // handed to the LLM as focus context (and whether any were bridges, since
      // bridge ids in focus are addressable directly without resolve_entity).
      const focusTrace = focusRecords.map((r: any) => ({
        type: r.type,
        id: r.id,
        isBridge: !!this.graphCatalog.getEntityDetail(r.type, userModuleIds)?.bridge,
      }));
      const backgroundTrace = backgroundStubs.map((s) => ({ type: s.type, id: s.id }));
      this.assistantLogger.log(
        `hydration: focus=${JSON.stringify(focusTrace)} background=${JSON.stringify(backgroundTrace)}`,
      );

      if (focusRecords.length === 0 && backgroundStubs.length === 0) return null;

      const sections: string[] = ["## Entities already in this conversation", ""];
      if (focusRecords.length > 0) {
        sections.push("### Full records from the previous answer");
        sections.push(
          'These are the entities your previous answer was about. When the user\'s new question refers to any of them — by name or implicitly ("these", "them", "other orders", "their invoices") — use their id directly. Do not call resolve_entity for a name that matches one of these.',
        );
        sections.push("");
        sections.push(JSON.stringify(focusRecords, null, 2));
        if (pinned.length > 0) {
          sections.push(
            "The user named some of these entities explicitly in the new question. Treat every entity listed above as already identified: use its id directly and do not call resolve_entity for its name.",
          );
        }
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
      this.assistantLogger.error(
        `buildHydrationMessage failed — proceeding without hydration: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return null;
    }
  }

  private async loadFocusRecords(
    refs: { type: string; id: string }[],
    userModuleIds: string[],
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    for (const ref of refs) {
      // Per-type module gate. getEntityDetail returns null when the type is
      // not accessible to the current userModuleIds.
      const detail = this.graphCatalog.getEntityDetail(ref.type, userModuleIds);
      if (!detail) continue;
      const svc = this.entityServices.get(ref.type);
      if (!svc) continue;
      try {
        const record: any = await svc.findRecordById({ id: ref.id });
        if (!record) continue;
        out.push({ ...this.stripFocusRecord(record), type: ref.type });
      } catch {
        // Deleted or RBAC-denied: drop silently.
        continue;
      }
    }
    return out;
  }

  /**
   * Strip a focus record's nested relationship objects down to {id, type, summary}
   * stubs. The hydration design rule (see bridge-entities spec) is that the focus
   * block carries the entity's own scalar fields plus id-stubs for relationships —
   * NOT a full one-hop expansion that includes the related node's own collections
   * (which are mapper-initialised to `[]` and look like authoritative empty data
   * to the LLM, causing it to skip the traverse and answer "empty" wrongly).
   */
  private stripFocusRecord(record: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (value === null || value === undefined) {
        result[key] = value;
        continue;
      }
      if (Array.isArray(value)) {
        result[key] = value.map((v) => this.stubRelatedRecord(v));
        continue;
      }
      if (typeof value === "object" && this.looksLikeRelatedRecord(value)) {
        result[key] = this.stubRelatedRecord(value);
        continue;
      }
      result[key] = value;
    }
    return result;
  }

  private looksLikeRelatedRecord(v: unknown): boolean {
    if (!v || typeof v !== "object") return false;
    const obj = v as Record<string, unknown>;
    return typeof obj.id === "string";
  }

  private stubRelatedRecord(v: unknown): unknown {
    if (!this.looksLikeRelatedRecord(v)) return v;
    const obj = v as Record<string, unknown>;
    const summarySource = obj.name ?? obj.number ?? obj.title ?? obj.id;
    const summary = typeof summarySource === "string" ? summarySource : String(summarySource ?? "");
    return {
      id: obj.id,
      type: obj.type ?? null,
      summary,
    };
  }

  private async loadBackgroundStubs(
    refs: { type: string; id: string }[],
    userModuleIds: string[],
  ): Promise<Array<{ type: string; id: string; label?: string }>> {
    const out: Array<{ type: string; id: string; label?: string }> = [];
    for (const ref of refs) {
      const detail = this.graphCatalog.getEntityDetail(ref.type, userModuleIds);
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
