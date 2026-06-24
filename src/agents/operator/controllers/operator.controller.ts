import { Body, Controller, Logger, Param, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AssistantActionDescriptor } from "../../../foundations/assistant-action/entities/assistant-action";
import { AssistantMessageDescriptor } from "../../../foundations/assistant-message/entities/assistant-message";
import { assistantMessageMeta } from "../../../foundations/assistant-message/entities/assistant-message.meta";
import { AssistantAppendDto } from "../../../foundations/assistant/dtos/assistant-append.dto";
import { AssistantPostDto } from "../../../foundations/assistant/dtos/assistant-post.dto";
import { AssistantDescriptor } from "../../../foundations/assistant/entities/assistant";
import { assistantMeta } from "../../../foundations/assistant/entities/assistant.meta";
import { mergeIncluded } from "../../../foundations/assistant/controllers/assistant.controller";
import { AssistantService } from "../../../foundations/assistant/services/assistant.service";
import { operatorMeta } from "../entities/operator.meta";

/**
 * Standalone HTTP surface for the checkpointed operator engine.
 *
 * The operator agent deliberately does NOT piggyback on the assistant
 * module's endpoints: it owns `POST /operator` and
 * `POST /operator/:assistantId/assistant-messages`. The persisted resources
 * are still Assistants / AssistantMessages / AssistantActions, so the
 * request DTOs and response documents reuse the assistant descriptors.
 */
@UseGuards(JwtAuthGuard)
@Controller()
export class OperatorController {
  private readonly logger = new Logger(OperatorController.name);

  constructor(
    private readonly assistants: AssistantService,
    private readonly jsonApi: JsonApiService,
  ) {}

  /**
   * POST /operator — create a new assistant thread whose turns run on the
   * checkpointed operator engine (durable, approval-gated). Response shape
   * mirrors the assistant `create()` route; when the run froze on a
   * destructive tool call, the pending `assistant-actions` resource is
   * included alongside the two messages so the client can render the
   * approval card immediately.
   */
  @Post(operatorMeta.endpoint)
  async create(@Body() body: AssistantPostDto, @Req() req: AuthenticatedRequest): Promise<any> {
    const { content, title, howToMode, limitToHowToId } = body.data.attributes;
    this.logger.log(
      `create: userId=${req.user.userId} companyId=${req.user.companyId} firstMessageLen=${content.length}`,
    );
    const { assistant, userMessage, assistantMessage, toolCalls, action } =
      await this.assistants.createWithFirstMessageOperator({
        companyId: req.user.companyId,
        userId: req.user.userId,
        firstMessage: content,
        title,
        howToMode,
        limitToHowToId,
      });
    const document = (await this.jsonApi.buildSingle(AssistantDescriptor.model, assistant)) as Record<string, any>;
    const messagesDoc = (await this.jsonApi.buildList(AssistantMessageDescriptor.model, [
      userMessage,
      assistantMessage,
    ])) as Record<string, any>;
    const additions: unknown[] = [
      ...(((messagesDoc as any).data as unknown[] | undefined) ?? []),
      ...(((messagesDoc as any).included as unknown[] | undefined) ?? []),
    ];
    if (action) {
      const actionDoc = (await this.jsonApi.buildSingle(AssistantActionDescriptor.model, action)) as Record<
        string,
        any
      >;
      additions.push(actionDoc.data);
    }
    document.included = mergeIncluded(document.included as unknown[] | undefined, additions, {
      type: assistantMeta.type,
      id: assistant.id,
    });
    document.meta = { ...(document.meta ?? {}), toolCalls };
    return document;
  }

  /**
   * POST /operator/:assistantId/assistant-messages — append a user message to
   * an existing thread and run the turn on the operator engine. Returns the
   * two new messages as a JSON:API list document (responder-append parity);
   * a pending approval surfaces the `assistant-actions` resource in `included`.
   */
  @Post(`${operatorMeta.endpoint}/:assistantId/${assistantMessageMeta.endpoint}`)
  async append(
    @Param("assistantId") assistantId: string,
    @Body() body: AssistantAppendDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<any> {
    const { content, howToMode, limitToHowToId } = body.data.attributes;
    this.logger.log(`append: assistantId=${assistantId} userId=${req.user.userId} messageLen=${content.length}`);
    const { userMessage, assistantMessage, toolCalls, action } = await this.assistants.appendMessageOperator({
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
    if (action) {
      const actionDoc = (await this.jsonApi.buildSingle(AssistantActionDescriptor.model, action)) as Record<
        string,
        any
      >;
      // Same dedupe/strip-backrefs merge as `create()` so the
      // `assistant-actions` resource renders identically from both endpoints.
      document.included = mergeIncluded(document.included as unknown[] | undefined, [actionDoc.data], {
        type: assistantMeta.type,
        id: assistantId,
      });
    }
    document.meta = { ...(document.meta ?? {}), toolCalls };
    return document;
  }
}
