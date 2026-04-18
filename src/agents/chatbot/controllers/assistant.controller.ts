import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
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
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AssistantAppendRequestDto } from "../dto/assistant-append.request.dto";
import { AssistantCreateRequestDto } from "../dto/assistant-create.request.dto";
import { AssistantPatchRequestDto } from "../dto/assistant-patch.request.dto";
import { ConversationDescriptor } from "../entities/conversation";
import { conversationMeta } from "../entities/conversation.meta";
import { ConversationService } from "../services/conversation.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);
  private readonly crud = createCrudHandlers(() => this.conversations);

  constructor(
    private readonly conversations: ConversationService,
    private readonly jsonApi: JsonApiService,
  ) {}

  /**
   * POST /assistants — create a new conversation with a first user message.
   *
   * Stays bespoke (not `crud.create`) because the agent turn must be computed
   * synchronously and the resulting user+assistant pair persisted atomically
   * with the new Conversation — there is no client-supplied payload that maps
   * cleanly onto `createFromDTO`.
   */
  @Post(conversationMeta.endpoint)
  async create(@Body() body: AssistantCreateRequestDto, @Req() req: AuthenticatedRequest): Promise<any> {
    const firstMessage = body.data.attributes.messages[0]!.content;
    this.logger.log(
      `create: userId=${req.user.userId} companyId=${req.user.companyId} firstMessageLen=${firstMessage.length}`,
    );
    const convo = await this.conversations.createWithFirstMessage({
      companyId: req.user.companyId,
      userId: req.user.userId,
      roles: req.user.roles,
      firstMessage,
      title: body.data.attributes.title,
    });
    return this.jsonApi.buildSingle(ConversationDescriptor.model, convo);
  }

  /**
   * POST /assistants/:conversationId/messages — append a user message to an existing conversation.
   *
   * Returns the full updated Conversation via the descriptor-driven serialiser
   * (the client can read the last two `messages[]` entries for the new user +
   * assistant pair). Per-turn `toolCalls` are surfaced in the document's
   * top-level `meta` for debug/inspection.
   */
  @Post(`${conversationMeta.endpoint}/:conversationId/messages`)
  async append(
    @Param("conversationId") conversationId: string,
    @Body() body: AssistantAppendRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<any> {
    this.logger.log(
      `append: conversationId=${conversationId} userId=${req.user.userId} messageLen=${body.data.attributes.content.length}`,
    );
    const { conversation, toolCalls } = await this.conversations.appendMessage({
      conversationId,
      companyId: req.user.companyId,
      userId: req.user.userId,
      roles: req.user.roles,
      newMessage: body.data.attributes.content,
    });

    const document = (await this.jsonApi.buildSingle(ConversationDescriptor.model, conversation)) as Record<
      string,
      any
    >;
    document.meta = { ...(document.meta ?? {}), toolCalls };
    return document;
  }

  /**
   * GET /assistants — list the current user's conversations.
   * RBAC (company + owner) is enforced by the repository's `buildUserHasAccess` override.
   */
  @Get(conversationMeta.endpoint)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  /**
   * GET /assistants/:conversationId — read a single conversation.
   */
  @Get(`${conversationMeta.endpoint}/:conversationId`)
  async findById(@Res() reply: FastifyReply, @Param("conversationId") conversationId: string) {
    return this.crud.findById(reply, conversationId);
  }

  /**
   * PATCH /assistants/:conversationId — partial update (e.g. rename) via JSON:API envelope.
   */
  @Patch(`${conversationMeta.endpoint}/:conversationId`)
  async patch(@Res() reply: FastifyReply, @Body() body: AssistantPatchRequestDto) {
    return this.crud.patch(reply, body);
  }

  /**
   * DELETE /assistants/:conversationId — permanently remove the conversation.
   */
  @Delete(`${conversationMeta.endpoint}/:conversationId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Res() reply: FastifyReply, @Param("conversationId") conversationId: string) {
    return this.crud.delete(reply, conversationId);
  }
}
