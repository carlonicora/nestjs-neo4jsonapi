import { Controller, Get, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { Audit, CacheInvalidate } from "../../../common/decorators";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { CacheService } from "../../../core/cache/services/cache.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AuditService } from "../../audit/services/audit.service";
import { AssistantService } from "../../assistant/services/assistant.service";
import { AssistantMessageDescriptor } from "../../assistant-message/entities/assistant-message";
import { AssistantActionDescriptor } from "../entities/assistant-action";
import { assistantActionMeta } from "../entities/assistant-action.meta";
import { AssistantActionService } from "../services/assistant-action.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class AssistantActionController {
  private readonly crud = createCrudHandlers(() => this.assistantActions);

  constructor(
    private readonly assistantActions: AssistantActionService,
    private readonly assistants: AssistantService,
    private readonly jsonApi: JsonApiService,
    private readonly auditService: AuditService,
    private readonly cacheService: CacheService,
  ) {}

  // GET /assistant-actions/:actionId
  @Get(`${assistantActionMeta.endpoint}/:actionId`)
  @Audit(assistantActionMeta, "actionId")
  async findById(@Req() request: FastifyRequest, @Res() reply: FastifyReply, @Param("actionId") actionId: string) {
    return this.crud.findById(reply, actionId);
  }

  /**
   * POST /assistant-actions/:actionId/approve — resolve the pending action and
   * resume the frozen operator run with approval. Synchronously returns the
   * final assistant message (JSON:API) with the resolved action included.
   */
  @Post(`${assistantActionMeta.endpoint}/:actionId/approve`)
  @CacheInvalidate(assistantActionMeta, "actionId")
  async approve(@Req() request: FastifyRequest, @Res() reply: FastifyReply, @Param("actionId") actionId: string) {
    return this.resolve(reply, actionId, true);
  }

  /**
   * POST /assistant-actions/:actionId/deny — resolve the pending action and
   * resume with denial. Returns the wrap-up assistant message with the
   * resolved action included.
   */
  @Post(`${assistantActionMeta.endpoint}/:actionId/deny`)
  @CacheInvalidate(assistantActionMeta, "actionId")
  async deny(@Req() request: FastifyRequest, @Res() reply: FastifyReply, @Param("actionId") actionId: string) {
    return this.resolve(reply, actionId, false);
  }

  private async resolve(reply: FastifyReply, actionId: string, approved: boolean) {
    const { assistantMessage, action } = await this.assistants.resolveAction({ actionId, approved });

    const document: any = await this.jsonApi.buildSingle(AssistantMessageDescriptor.model, assistantMessage);
    const actionDocument: any = await this.jsonApi.buildSingle(AssistantActionDescriptor.model, action);

    // Merge the resolved action into `included`, deduping by (type,id) and
    // never echoing the primary message resource back into `included`.
    const merged = [...(document.included ?? []), actionDocument.data, ...(actionDocument.included ?? [])];
    const seen = new Set<string>();
    document.included = merged.filter((resource: any) => {
      if (!resource) return false;
      if (resource.type === document.data?.type && resource.id === document.data?.id) return false;
      const key = `${resource.type}-${resource.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    reply.send(document);
  }
}
