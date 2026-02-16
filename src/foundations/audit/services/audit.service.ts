import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { auditModel } from "../../audit/entities/audit.model";
import { AuditRepository } from "../../audit/repositories/audit.repository";

@Injectable()
export class AuditService {
  constructor(
    private readonly builder: JsonApiService,
    private readonly auditRepository: AuditRepository,
    private readonly clsService: ClsService,
  ) {}

  async createAuditEntry(params: { entityType: string; entityId: string }): Promise<void> {
    const userId = this.clsService.get("userId");
    if (!userId) return;

    await this.auditRepository.create({
      userId: userId,
      entityType: params.entityType,
      entityId: params.entityId,
      auditType: "read",
      changes: undefined,
    });
  }

  async createWriteAuditEntry(params: {
    entityType: string;
    entityId: string;
    auditType: "create" | "edit";
    changes?: string;
  }): Promise<void> {
    const userId = this.clsService.get("userId");
    if (!userId) return;

    await this.auditRepository.create({
      userId: userId,
      entityType: params.entityType,
      entityId: params.entityId,
      auditType: params.auditType,
      changes: params.changes,
    });
  }

  async findByUser(params: { query: any; userId: string }): Promise<void> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    try {
      return this.builder.buildList(
        auditModel,
        await this.auditRepository.findByUser({ userId: params.userId, cursor: paginator.generateCursor() }),
        paginator,
      );
    } catch (error) {
      console.error("Error in findByUser:", error);
      throw error;
    }
  }
}
