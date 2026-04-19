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
import { AssistantAppendDto } from "../dtos/assistant-append.dto";
import { AssistantPatchDto } from "../dtos/assistant-patch.dto";
import { AssistantPostDto } from "../dtos/assistant-post.dto";
import { AssistantDescriptor } from "../entities/assistant";
import { assistantMeta } from "../entities/assistant.meta";
import { AssistantMessageDescriptor } from "../../assistant-message/entities/assistant-message";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { AssistantService } from "../services/assistant.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);
  private readonly crud = createCrudHandlers(() => this.assistants);

  constructor(
    private readonly assistants: AssistantService,
    private readonly jsonApi: JsonApiService,
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
    const firstMessage = body.data.attributes.content;
    this.logger.log(
      `create: userId=${req.user.userId} companyId=${req.user.companyId} firstMessageLen=${firstMessage.length}`,
    );
    const { assistant, userMessage, assistantMessage, toolCalls } = await this.assistants.createWithFirstMessage({
      companyId: req.user.companyId,
      userId: req.user.userId,
      roles: req.user.roles,
      firstMessage,
      title: body.data.attributes.title,
    });
    const document = (await this.jsonApi.buildSingle(AssistantDescriptor.model, assistant)) as Record<string, any>;
    const included = (await this.jsonApi.buildList(AssistantMessageDescriptor.model, [
      userMessage,
      assistantMessage,
    ])) as Record<string, any>;
    document.included = [
      ...(Array.isArray(document.included) ? document.included : []),
      ...(Array.isArray(included.data) ? included.data : []),
    ];
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
    this.logger.log(
      `append: assistantId=${assistantId} userId=${req.user.userId} messageLen=${body.data.attributes.content.length}`,
    );
    const { userMessage, assistantMessage, toolCalls } = await this.assistants.appendMessage({
      assistantId,
      companyId: req.user.companyId,
      userId: req.user.userId,
      roles: req.user.roles,
      newMessage: body.data.attributes.content,
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
   */
  @Get(assistantMeta.endpoint)
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
