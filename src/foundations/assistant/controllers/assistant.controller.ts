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
   * Stays bespoke (not `crud.create`) because the agent turn must be computed
   * synchronously and the resulting user+assistant pair persisted atomically
   * with the new Assistant — there is no client-supplied payload that maps
   * cleanly onto `createFromDTO` at the controller layer. Internally the
   * service still routes through `createFromDTO` so `contextKey: "userId"`
   * on the `owner` relationship attaches the `CREATED_BY` edge from CLS.
   */
  @Post(assistantMeta.endpoint)
  async create(@Body() body: AssistantPostDto, @Req() req: AuthenticatedRequest): Promise<any> {
    const firstMessage = body.data.attributes.content;
    this.logger.log(
      `create: userId=${req.user.userId} companyId=${req.user.companyId} firstMessageLen=${firstMessage.length}`,
    );
    const { assistant, toolCalls } = await this.assistants.createWithFirstMessage({
      companyId: req.user.companyId,
      userId: req.user.userId,
      roles: req.user.roles,
      firstMessage,
      title: body.data.attributes.title,
    });
    const document = (await this.jsonApi.buildSingle(AssistantDescriptor.model, assistant)) as Record<string, any>;
    document.meta = { ...(document.meta ?? {}), toolCalls };
    return document;
  }

  /**
   * POST /assistants/:assistantId/messages — append a user message to an existing assistant thread.
   *
   * Returns the full updated Assistant via the descriptor-driven serialiser
   * (the client can read the last two `messages[]` entries for the new user +
   * assistant pair). Per-turn `toolCalls` are surfaced in the document's
   * top-level `meta` for debug/inspection.
   */
  @Post(`${assistantMeta.endpoint}/:assistantId/messages`)
  async append(
    @Param("assistantId") assistantId: string,
    @Body() body: AssistantAppendDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<any> {
    this.logger.log(
      `append: assistantId=${assistantId} userId=${req.user.userId} messageLen=${body.data.attributes.content.length}`,
    );
    const { assistant, toolCalls } = await this.assistants.appendMessage({
      assistantId,
      companyId: req.user.companyId,
      userId: req.user.userId,
      roles: req.user.roles,
      newMessage: body.data.attributes.content,
    });

    const document = (await this.jsonApi.buildSingle(AssistantDescriptor.model, assistant)) as Record<string, any>;
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
