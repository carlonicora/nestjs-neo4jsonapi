import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { ResponderService } from "../../../agents/responder/services/responder.service";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { HandbookThread, HandbookThreadDescriptor } from "../entities/handbook-thread";
import { handbookThreadMeta } from "../entities/handbook-thread.meta";
import {
  HandbookThreadMessage,
  HandbookThreadMessageDescriptor,
  HandbookThreadMessageRole,
} from "../entities/handbook-thread-message";
import { handbookThreadMessageMeta } from "../entities/handbook-thread-message.meta";
import { HandbookPageRepository } from "../repositories/handbook-page.repository";
import { HandbookThreadMessageRepository } from "../repositories/handbook-thread-message.repository";
import { HandbookThreadRepository } from "../repositories/handbook-thread.repository";
import { HandbookThreadMessageService } from "./handbook-thread-message.service";

/** How many prior turns are replayed to the responder as history. */
export const HANDBOOK_MAX_MESSAGES_TO_LLM = 20;

/** Longest auto-generated title, when the responder supplies none. */
export const HANDBOOK_TITLE_MAX_LENGTH = 60;

/**
 * Persisted handbook conversations.
 *
 * The handbook chat deliberately does NOT go through the package `Assistant`.
 * `Assistant` is `isCompanyScoped: true`, and a platform administrator — the
 * only user this feature is for — has no Company, so a company-scoped thread
 * would 404 for exactly that user. Company scoping stays strict; the thread
 * lives here instead, global and owner-scoped.
 *
 * That is why `companyId` is read off CLS and passed through EXACTLY as found,
 * `undefined` included. It is not defaulted, substituted or looked up.
 * `ResponderService.run` types it `string | undefined`; token accounting
 * already tolerates a company-less turn (TokenUsageRepository makes the
 * `BELONGS_TO` edge conditional); and handbook retrieval never consults a
 * company — the handbook branch of the source-query provider matches
 * `(:HandbookPage)` and ignores tenancy altogether.
 */
@Injectable()
export class HandbookThreadService extends AbstractService<
  HandbookThread,
  typeof HandbookThreadDescriptor.relationships
> {
  protected readonly descriptor = HandbookThreadDescriptor;
  private readonly threadLogger = new Logger(HandbookThreadService.name);

  constructor(
    jsonApiService: JsonApiService,
    private readonly threads: HandbookThreadRepository,
    clsService: ClsService,
    private readonly responder: ResponderService,
    private readonly messages: HandbookThreadMessageService,
    private readonly messageRepository: HandbookThreadMessageRepository,
    private readonly pages: HandbookPageRepository,
  ) {
    super(jsonApiService, threads, clsService, HandbookThreadDescriptor.model);
  }

  /**
   * Start a thread from its first question: create the thread, run the turn,
   * persist both messages, and title the thread from the answer.
   *
   * The thread node is created FIRST — before the responder runs — so the two
   * messages have a parent to hang from, exactly as
   * `AssistantService.createWithFirstMessage` does. It is created with the
   * fallback title and retitled once the answer exists, because the responder's
   * title is only known after the turn.
   */
  async createWithFirstMessage(params: {
    question: string;
    /** Optional: scopes retrieval to one page. See `runTurn`. */
    handbookPageId?: string;
  }): Promise<JsonApiDataInterface> {
    const threadId = randomUUID();

    await this.createFromDTO({
      data: {
        type: handbookThreadMeta.type,
        id: threadId,
        attributes: { title: this.fallbackTitle(params.question) },
      },
    });

    await this.writeMessage({ threadId, role: "user", content: params.question, position: 0, sources: [] });

    const turn = await this.runTurn({
      question: params.question,
      history: [],
      handbookPageId: params.handbookPageId,
    });

    await this.writeMessage({
      threadId,
      role: "assistant",
      content: turn.answer,
      position: 1,
      sources: turn.sources,
    });

    // `patch` here is the OVERRIDE below, so the owner gate is applied to the
    // retitle as well — the thread was created by this user a moment ago, so it
    // always passes, but the rule stays in one place.
    if (turn.title) await this.patch({ id: threadId, title: turn.title });

    this.threadLogger.log(
      `createWithFirstMessage: threadId=${threadId} questionLength=${params.question.length} sources=${turn.sources.length}`,
    );

    return this.findThreadWithMessages({ threadId });
  }

  /**
   * Append a question to an existing thread and answer it with the thread's
   * prior messages as history.
   *
   * Returns the two NEW messages as a JSON:API list — the shape
   * `AssistantController.append` returns — so the client appends rather than
   * re-renders. The full thread is one `GET /handbookthreads/:id` away.
   */
  async appendMessage(params: {
    threadId: string;
    question: string;
    /** Optional: scopes retrieval to one page. See `runTurn`. */
    handbookPageId?: string;
  }): Promise<JsonApiDataInterface> {
    // Owner gate: `findById` applies `buildUserHasAccess`, so another user's
    // thread is a 403 and an unknown id is a 404 — before anything is written.
    await this.readOwnedThread({ threadId: params.threadId });

    const priorMessages = await this.loadMessages({ threadId: params.threadId });
    const position = await this.messageRepository.getNextPosition({ threadId: params.threadId });

    const userMessageId = await this.writeMessage({
      threadId: params.threadId,
      role: "user",
      content: params.question,
      position,
      sources: [],
    });

    const turn = await this.runTurn({
      question: params.question,
      history: priorMessages.slice(-HANDBOOK_MAX_MESSAGES_TO_LLM).map((message) => ({
        type: message.role === "assistant" ? AgentMessageType.Assistant : AgentMessageType.User,
        content: message.content,
      })),
      handbookPageId: params.handbookPageId,
    });

    const assistantMessageId = await this.writeMessage({
      threadId: params.threadId,
      role: "assistant",
      content: turn.answer,
      position: position + 1,
      sources: turn.sources,
    });

    await this.threads.touch({ id: params.threadId });

    this.threadLogger.log(
      `appendMessage: threadId=${params.threadId} positions=${position}-${position + 1} history=${priorMessages.length}`,
    );

    const written = await this.messageRepository.findByIds({ ids: [userMessageId, assistantMessageId] });
    return this.jsonApiService.buildList(
      HandbookThreadMessageDescriptor.model,
      this.byPosition(written as HandbookThreadMessage[]),
    );
  }

  /**
   * One thread with every message it holds, in position order.
   *
   * The messages ride in `included` through the descriptor's `messages`
   * relationship — the same traversal that lets `AssistantController` return an
   * assistant with its messages — so a client renders a selected thread in one
   * call. They are sorted here because a Cypher `OPTIONAL MATCH` collects
   * related nodes in no particular order.
   */
  async findThreadWithMessages(params: { threadId: string }): Promise<JsonApiDataInterface> {
    const thread = await this.readOwnedThread({ threadId: params.threadId });
    thread.messages = this.byPosition(thread.messages ?? []);
    return this.jsonApiService.buildSingle(HandbookThreadDescriptor.model, thread);
  }

  /**
   * Rename. Overridden ONLY to close an ordering hole in the inherited
   * implementation: `AbstractService.patch` writes first and reads back
   * afterwards, and `AbstractRepository.patch` matches on `id` alone — it never
   * applies `buildUserHasAccess`. Without the read below, one administrator
   * could rename another's thread and merely be refused the response.
   */
  async patch(params: { id: string; [key: string]: any }): Promise<JsonApiDataInterface> {
    await this.readOwnedThread({ threadId: params.id });
    return super.patch(params);
  }

  /**
   * Delete the thread and, through the repository override, its messages.
   *
   * Overridden because the inherited `AbstractService.delete` guards ownership
   * with a COMPANY comparison — `(companyId ?? "") !== entity.company?.id`. A
   * `HandbookThread` is `isCompanyScoped: false`, so `entity.company` is always
   * undefined, and an administrator has no `companyId`: the comparison reduces
   * to `"" !== undefined`, which is true, and EVERY delete would 403. The owner
   * edge is the boundary here, and `readOwnedThread` is what enforces it.
   */
  async delete(params: { id: string }): Promise<void> {
    await this.readOwnedThread({ threadId: params.id });
    await this.threads.delete({ id: params.id });
    this.threadLogger.log(`delete: threadId=${params.id}`);
  }

  /**
   * Read a thread through the owner-scoped `findById`. A thread belonging to
   * another user raises 403 from `_validateForbidden`; an id that matches
   * nothing comes back null and becomes a 404 here.
   */
  private async readOwnedThread(params: { threadId: string }): Promise<HandbookThread> {
    const thread = await this.threads.findById({ id: params.threadId });
    if (!thread) throw new NotFoundException();
    return thread;
  }

  /**
   * Run one handbook turn on the responder and resolve its citations to page
   * paths.
   *
   * `userModuleIds: []` is not a stub: the documentation branch never runs the
   * graph or the planner, and those two are the only readers of that list.
   *
   * `handbookPageId` is forwarded as `limitToHandbookPageId`, which the
   * handbook source-query provider already honours by adding
   * `WHERE data.id = $limitToHandbookPageId` to the `(:HandbookPage)` match.
   * Passed through EXACTLY as received, `undefined` included: an absent value
   * means retrieval spans the whole manual, which is the default a question
   * asked while reading one page usually wants.
   */
  private async runTurn(params: {
    question: string;
    history: MessageInterface[];
    handbookPageId?: string;
  }): Promise<{ answer: string; title: string; sources: string[] }> {
    // `|| undefined` collapses the empty string a company-less CLS context can
    // carry into the same absent value, so the responder sees one shape.
    const companyId = (this.clsService.get("companyId") as string | undefined) || undefined;
    const userId = this.clsService.get("userId") as string;

    const response = await this.responder.run({
      companyId,
      userId,
      userModuleIds: [],
      dataLimits: { handbookMode: true, limitToHandbookPageId: params.handbookPageId },
      messages: params.history,
      question: params.question,
    });

    const chunkIds = (response.sources ?? [])
      .map((source) => source.chunkId)
      .filter((chunkId): chunkId is string => typeof chunkId === "string" && chunkId.length > 0);

    // The repository answers one path per RESOLVABLE chunk, in citation order;
    // several chunks of the same page collapse here. A chunk whose page cannot
    // be resolved never reaches this list, so no source is ever an empty string.
    const paths = await this.pages.findPathsByChunkIds({ chunkIds });

    return {
      answer: response.answer?.answer ?? "",
      title: response.answer?.title?.trim() ?? "",
      sources: [...new Set(paths)],
    };
  }

  /** Persist one message under a thread. Returns the new message's id. */
  private async writeMessage(params: {
    threadId: string;
    role: HandbookThreadMessageRole;
    content: string;
    position: number;
    sources: string[];
  }): Promise<string> {
    const id = randomUUID();

    await this.messages.createFromDTO({
      data: {
        type: handbookThreadMessageMeta.type,
        id,
        attributes: {
          role: params.role,
          content: params.content,
          position: params.position,
          sources: params.sources,
        },
        relationships: {
          thread: { data: { type: handbookThreadMeta.type, id: params.threadId } },
        },
      },
    });

    return id;
  }

  /** Every message of a thread, oldest first. */
  private async loadMessages(params: { threadId: string }): Promise<HandbookThreadMessage[]> {
    const messages = await this.messageRepository.findByRelated({
      relationship: HandbookThreadMessageDescriptor.relationshipKeys.thread,
      id: params.threadId,
      fetchAll: true,
      orderBy: "position ASC",
    });

    return this.byPosition(messages);
  }

  /**
   * Sort by `position` ascending. Applied even to results that were queried
   * with an ORDER BY: the ordering clause sits ahead of the relationship
   * traversal `buildReturnStatement()` appends, so it is not guaranteed to
   * survive into the rows. Position is the only ordering the client can rely
   * on, so it is asserted where the list is produced.
   */
  private byPosition(messages: HandbookThreadMessage[]): HandbookThreadMessage[] {
    return [...messages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  /**
   * Title for a thread whose answer produced none: the question, trimmed to
   * 60 characters on a word boundary. Mirrors `AssistantService.autoTitle`.
   */
  private fallbackTitle(question: string): string {
    const trimmed = question.trim();
    if (trimmed.length <= HANDBOOK_TITLE_MAX_LENGTH) return trimmed;

    const truncated = trimmed.slice(0, HANDBOOK_TITLE_MAX_LENGTH);
    const lastSpace = truncated.lastIndexOf(" ");
    return lastSpace > HANDBOOK_TITLE_MAX_LENGTH / 2 ? truncated.slice(0, lastSpace).trim() : truncated.trim();
  }
}
