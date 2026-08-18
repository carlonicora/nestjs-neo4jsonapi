import { Controller, Get, Inject, NotFoundException, Optional, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { Audit, CacheInvalidate } from "../../../common/decorators";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { isAiEnabledVia } from "../../../common/helpers/credit-gate";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CREDIT_VALIDATOR, CreditValidatorInterface } from "../../../common/tokens";
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
    /**
     * Approving or denying a pending action RESUMES a frozen operator run —
     * i.e. it runs the LLM. Same seam and same 404 as `AssistantController`.
     */
    @Optional() @Inject(CREDIT_VALIDATOR) private readonly creditValidator?: CreditValidatorInterface,
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
  async approve(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("actionId") actionId: string) {
    await this.gate(request);
    return this.resolve(reply, actionId, true);
  }

  /**
   * POST /assistant-actions/:actionId/deny — resolve the pending action and
   * resume with denial. Returns the wrap-up assistant message with the
   * resolved action included.
   */
  @Post(`${assistantActionMeta.endpoint}/:actionId/deny`)
  @CacheInvalidate(assistantActionMeta, "actionId")
  async deny(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("actionId") actionId: string) {
    await this.gate(request);
    return this.resolve(reply, actionId, false);
  }

  /**
   * 404 when the caller's plan carries no AI, then the ordinary credit check.
   *
   * Order matters and mirrors `AssistantController`: an AI-free company must
   * never receive a 402, because "pay and you can have this" tells them AI
   * exists. Resuming the run is an unmetered LLM turn without both checks.
   */
  private async gate(request: AuthenticatedRequest): Promise<void> {
    const companyId = request.user?.companyId;
    if (!companyId) return;

    if (!(await isAiEnabledVia(this.creditValidator, { companyId }))) throw new NotFoundException();

    if (this.creditValidator) await this.creditValidator.validateCredits({ companyId });
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
