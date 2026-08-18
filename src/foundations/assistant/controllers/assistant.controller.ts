import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { isAiEnabledVia } from "../../../common/helpers/credit-gate";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { modelRegistry } from "../../../common/registries/registry";
import { CREDIT_VALIDATOR, CreditValidatorInterface } from "../../../common/tokens";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AssistantAppendDto } from "../dtos/assistant-append.dto";
import { AssistantPatchDto } from "../dtos/assistant-patch.dto";
import { AssistantPostDto } from "../dtos/assistant-post.dto";
import { AssistantDescriptor } from "../entities/assistant";
import { assistantMeta } from "../entities/assistant.meta";
import { AssistantMessageDescriptor } from "../../assistant-message/entities/assistant-message";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { AssistantService } from "../services/assistant.service";

/**
 * Merge two JSON:API `included` lists for the `create()` response.
 *
 * `buildSingle(Assistant)` traverses the Assistant's `messages` relationship and
 * emits slim message entries. `buildList([userMsg, assistantMsg])` serialises
 * the same messages as top-level resources, richer and carrying a
 * `relationships.assistant` back-pointer. Concatenating produced duplicates
 * (slim + rich per message) and leaked the back-pointer. We want one rich copy
 * per (type,id), minus the back-pointer to the primary Assistant.
 *
 * Dedup rule: last-wins by (type,id) — `buildList` output overrides
 * `buildSingle` traversal. Back-pointer rule: when an included resource's
 * relationship points to `stripBackrefsTo`, drop that relationship entry;
 * if the resulting `relationships` object is empty, drop the property too.
 */
export function mergeIncluded(
  base: unknown[] | undefined,
  additions: unknown[] | undefined,
  stripBackrefsTo: { type: string; id: string } | null,
): any[] {
  const byKey = new Map<string, any>();
  for (const list of [base, additions]) {
    for (const item of (list ?? []) as any[]) {
      byKey.set(`${item.type}-${item.id}`, item);
    }
  }
  if (stripBackrefsTo) {
    // The primary resource must never appear in `included`. `buildList` on the
    // messages emits the Assistant as an inline resource because each message
    // declares `relationships.assistant`; that copy has to be dropped.
    byKey.delete(`${stripBackrefsTo.type}-${stripBackrefsTo.id}`);
    for (const item of byKey.values()) {
      if (!item.relationships) continue;
      for (const [rel, value] of Object.entries(item.relationships)) {
        const v = value as any;
        if (v?.data?.type === stripBackrefsTo.type && v?.data?.id === stripBackrefsTo.id) {
          delete item.relationships[rel];
        }
      }
      if (Object.keys(item.relationships).length === 0) {
        delete item.relationships;
      }
    }
  }
  return Array.from(byKey.values());
}

@UseGuards(JwtAuthGuard)
@Controller()
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);
  private readonly crud = createCrudHandlers(() => this.assistants);

  constructor(
    private readonly assistants: AssistantService,
    private readonly jsonApi: JsonApiService,
    @Optional() @Inject(CREDIT_VALIDATOR) private readonly creditValidator?: CreditValidatorInterface,
  ) {}

  /**
   * POST /assistants — create a new assistant thread with a first user message.
   *
   * Response shape: Assistant JSON:API document with `meta.toolCalls`. The
   * first user + assistant messages are embedded in the `included` array as
   * `assistant-messages` (pre-populated server-side so the client does not need
   * a round-trip to render the initial thread).
   */
  @Post(assistantMeta.endpoint)
  async create(@Body() body: AssistantPostDto, @Req() req: AuthenticatedRequest): Promise<any> {
    if (req.user?.companyId && !(await isAiEnabledVia(this.creditValidator, { companyId: req.user.companyId }))) {
      throw new NotFoundException();
    }

    if (this.creditValidator && req.user?.companyId)
      await this.creditValidator.validateCredits({ companyId: req.user.companyId });

    const { content, title, howToMode, limitToHowToId } = body.data.attributes;
    const boundContent = this.resolveBoundContent(body.data.relationships?.content?.data);
    this.logger.log(
      `create: userId=${req.user.userId} companyId=${req.user.companyId} firstMessageLen=${content.length}` +
        (boundContent ? ` boundTo=${boundContent.type}/${boundContent.id}` : ""),
    );
    const { assistant, userMessage, assistantMessage, toolCalls } = await this.assistants.createWithFirstMessage({
      companyId: req.user.companyId,
      userId: req.user.userId,
      firstMessage: content,
      title,
      howToMode,
      limitToHowToId,
      boundContent,
    });
    const document = (await this.jsonApi.buildSingle(AssistantDescriptor.model, assistant)) as Record<string, any>;
    const messagesDoc = (await this.jsonApi.buildList(AssistantMessageDescriptor.model, [
      userMessage,
      assistantMessage,
    ])) as Record<string, any>;
    // `messagesDoc.data` is the two serialised messages (rich form, replacing
    // the slim traversal copies in `document.included`).
    // `messagesDoc.included` is every *nested* resource the messages referenced
    // — e.g. the polymorphic Order / Account / Person entities surfaced by
    // AssistantMessage.references. Dropping it leaves the client with bare
    // {type,id} refs and nothing to render. Merge both sources.
    const additions: unknown[] = [
      ...(((messagesDoc as any).data as unknown[] | undefined) ?? []),
      ...(((messagesDoc as any).included as unknown[] | undefined) ?? []),
    ];
    document.included = mergeIncluded(document.included as unknown[] | undefined, additions, {
      type: assistantMeta.type,
      id: assistant.id,
    });
    document.meta = { ...(document.meta ?? {}), toolCalls };
    return document;
  }

  /**
   * POST /assistants/:assistantId/assistant-messages — append a user message to an existing
   * assistant thread. Runs the agent turn synchronously and returns a JSON:API list
   * document containing the two new messages (user + assistant). `toolCalls` is surfaced
   * in the document's `meta`.
   */
  @Post(`${assistantMeta.endpoint}/:assistantId/${assistantMessageMeta.endpoint}`)
  async append(
    @Param("assistantId") assistantId: string,
    @Body() body: AssistantAppendDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<any> {
    if (req.user?.companyId && !(await isAiEnabledVia(this.creditValidator, { companyId: req.user.companyId }))) {
      throw new NotFoundException();
    }

    if (this.creditValidator && req.user?.companyId)
      await this.creditValidator.validateCredits({ companyId: req.user.companyId });

    const { content, howToMode, limitToHowToId } = body.data.attributes;
    this.logger.log(`append: assistantId=${assistantId} userId=${req.user.userId} messageLen=${content.length}`);
    const { userMessage, assistantMessage, toolCalls } = await this.assistants.appendMessage({
      assistantId,
      companyId: req.user.companyId,
      userId: req.user.userId,
      newMessage: content,
      howToMode,
      limitToHowToId,
    });

    const document = (await this.jsonApi.buildList(AssistantMessageDescriptor.model, [
      userMessage,
      assistantMessage,
    ])) as Record<string, any>;
    document.meta = { ...(document.meta ?? {}), toolCalls };
    return document;
  }

  /**
   * GET /assistants — list the current user's assistant threads.
   * RBAC (company + owner) is enforced by the repository's `buildUserHasAccess` override.
   *
   * `boundType` + `boundId` narrow the list to the threads bound to one
   * resource (e.g. a campaign). Both are required together: a bound id with no
   * type is ambiguous, and a type with no id names no resource. Supplying them
   * is a custom filter, so it bypasses the CRUD handler and calls the service.
   */
  @Get(assistantMeta.endpoint)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
    @Query("boundType") boundType?: string,
    @Query("boundId") boundId?: string,
  ) {
    if (boundType && boundId) {
      if (!modelRegistry.getByType(boundType)) {
        throw new BadRequestException(`Unknown resource type "${boundType}" for boundType.`);
      }
      const response = await this.assistants.findByBoundContent({ boundType, boundId, query });
      reply.send(response);
      return;
    }
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  /**
   * Validate the polymorphic `content` relationship reference against the model
   * registry. The DTO can only assert that `type` is a non-empty string —
   * BOUND_TO accepts any registered model, and the registry is the only place
   * that knows the full set.
   */
  private resolveBoundContent(reference?: { type: string; id: string }): { type: string; id: string } | undefined {
    if (!reference) return undefined;
    const model = modelRegistry.getByType(reference.type);
    if (!model) {
      throw new BadRequestException(`Unknown resource type "${reference.type}" for the assistant's bound content.`);
    }
    return { type: model.type, id: reference.id };
  }

  /**
   * GET /assistants/:assistantId — read a single assistant thread.
   */
  @Get(`${assistantMeta.endpoint}/:assistantId`)
  async findById(@Res() reply: FastifyReply, @Param("assistantId") assistantId: string) {
    return this.crud.findById(reply, assistantId);
  }

  /**
   * PATCH /assistants/:assistantId — partial update (e.g. rename) via JSON:API envelope.
   */
  @Patch(`${assistantMeta.endpoint}/:assistantId`)
  async patch(@Res() reply: FastifyReply, @Body() body: AssistantPatchDto) {
    return this.crud.patch(reply, body);
  }

  /**
   * DELETE /assistants/:assistantId — permanently remove the assistant thread.
   */
  @Delete(`${assistantMeta.endpoint}/:assistantId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Res() reply: FastifyReply, @Param("assistantId") assistantId: string) {
    return this.crud.delete(reply, assistantId);
  }
}
