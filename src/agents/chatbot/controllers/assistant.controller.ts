import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AssistantAppendRequestDto } from "../dto/assistant-append.request.dto";
import { AssistantCreateRequestDto } from "../dto/assistant-create.request.dto";
import { AssistantPatchRequestDto } from "../dto/assistant-patch.request.dto";
import { ConversationDescriptor } from "../entities/conversation";
import { ConversationService } from "../services/conversation.service";

@Controller("assistants")
@UseGuards(JwtAuthGuard)
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(
    private readonly conversations: ConversationService,
    private readonly jsonApi: JsonApiService,
  ) {}

  /**
   * POST /assistants — create a new conversation with a first user message.
   * Runs the agent turn synchronously and stores the user+assistant pair.
   */
  @Post()
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
   * POST /assistants/:id/messages — append a user message to an existing conversation.
   * Returns the user + assistant messages as a synthetic JSON:API collection of
   * type `messages`, plus the tool calls observed during this turn in `meta`.
   */
  @Post(":id/messages")
  async append(
    @Param("id") id: string,
    @Body() body: AssistantAppendRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<any> {
    this.logger.log(`append: id=${id} userId=${req.user.userId} messageLen=${body.data.attributes.content.length}`);
    const { userMessage, assistantMessage, toolCalls } = await this.conversations.appendMessage({
      conversationId: id,
      companyId: req.user.companyId,
      userId: req.user.userId,
      roles: req.user.roles,
      newMessage: body.data.attributes.content,
    });

    // Messages are projections, not stored JSON:API resources, so we hand-assemble
    // a valid JSON:API document here. `meta.conversationId` and `meta.toolCalls`
    // let the client correlate and display agent activity.
    return {
      data: [
        { type: "messages", id: userMessage.id, attributes: { ...userMessage } },
        { type: "messages", id: assistantMessage.id, attributes: { ...assistantMessage } },
      ],
      meta: { conversationId: id, toolCalls },
    };
  }

  /**
   * GET /assistants — list the current user's conversations.
   * RBAC (company + owner) is enforced by the repository's `buildUserHasAccess` override.
   */
  @Get()
  async list(): Promise<any> {
    const convos = await this.conversations.findAll();
    return this.jsonApi.buildList(ConversationDescriptor.model, convos);
  }

  /**
   * GET /assistants/:id — read a single conversation with full messages array.
   */
  @Get(":id")
  async read(@Param("id") id: string): Promise<any> {
    const convo = await this.conversations.findById({ conversationId: id });
    return this.jsonApi.buildSingle(ConversationDescriptor.model, convo);
  }

  /**
   * PATCH /assistants/:id — rename (update title) of an existing conversation.
   */
  @Patch(":id")
  async rename(@Param("id") id: string, @Body() body: AssistantPatchRequestDto): Promise<any> {
    const title = body.data.attributes.title;
    if (!title) {
      return this.jsonApi.buildSingle(
        ConversationDescriptor.model,
        await this.conversations.findById({ conversationId: id }),
      );
    }
    const updated = await this.conversations.rename({ conversationId: id, title });
    return this.jsonApi.buildSingle(ConversationDescriptor.model, updated);
  }

  /**
   * DELETE /assistants/:id — permanently remove the conversation.
   */
  @Delete(":id")
  @HttpCode(204)
  async delete(@Param("id") id: string): Promise<void> {
    await this.conversations.remove({ conversationId: id });
  }
}
