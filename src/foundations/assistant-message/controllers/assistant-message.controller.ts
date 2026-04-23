import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Query, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { createRelationshipHandlers } from "../../../common/handlers/relationship.handlers";
import { assistantMeta } from "../../assistant/entities/assistant.meta";
import { AssistantMessageDescriptor } from "../entities/assistant-message";
import { assistantMessageMeta } from "../entities/assistant-message.meta";
import { AssistantMessageService } from "../services/assistant-message.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class AssistantMessageController {
  private readonly crud = createCrudHandlers(() => this.messages);
  private readonly relationships = createRelationshipHandlers(() => this.messages);

  constructor(private readonly messages: AssistantMessageService) {}

  /**
   * GET /assistants/:assistantId/assistant-messages — paginated list of
   * messages for a thread, ordered by position ASC (default) via findByRelated.
   */
  @Get(`${assistantMeta.endpoint}/:assistantId/${assistantMessageMeta.endpoint}`)
  async findByAssistant(
    @Res() reply: FastifyReply,
    @Param("assistantId") assistantId: string,
    @Query() query: any,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.relationships.findByRelated(reply, {
      relationship: AssistantMessageDescriptor.relationshipKeys.assistant,
      id: assistantId,
      query,
      fetchAll,
      orderBy: orderBy ?? "position",
    });
  }

  @Get(`${assistantMessageMeta.endpoint}/:assistantMessageId`)
  async findById(@Res() reply: FastifyReply, @Param("assistantMessageId") assistantMessageId: string) {
    return this.crud.findById(reply, assistantMessageId);
  }

  @Delete(`${assistantMessageMeta.endpoint}/:assistantMessageId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Res() reply: FastifyReply, @Param("assistantMessageId") assistantMessageId: string) {
    return this.crud.delete(reply, assistantMessageId);
  }
}
