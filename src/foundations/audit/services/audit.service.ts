import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { SystemRoles } from "../../../common/constants/system.roles";
import { SYSTEM_ROLES, SystemRolesInterface } from "../../../common/tokens";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { EntityDescriptor } from "../../../common/interfaces/entity.schema.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { auditLogModel } from "../entities/audit.model";
import { AuditRepository } from "../repositories/audit.repository";

interface AuditChange {
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  isStatusChange: boolean;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly builder: JsonApiService,
    private readonly auditRepository: AuditRepository,
    private readonly clsService: ClsService,
    @Optional()
    @Inject(SYSTEM_ROLES)
    private readonly systemRoles?: SystemRolesInterface,
    @Optional()
    private readonly logger?: AppLoggingService,
  ) {}

  /**
   * System Administrators must never produce audit entries. Roles are read from CLS,
   * where JwtAuthGuard / AdminJwtAuthGuard / OptionalJwtAuthGuard store them.
   */
  private isAdministrator(): boolean {
    const roles = this.clsService.get<string[]>("roles");
    if (!Array.isArray(roles)) return false;
    const administratorRoleId = this.systemRoles?.Administrator ?? SystemRoles.Administrator;
    return roles.includes(administratorRoleId);
  }

  /**
   * Returns the current user id when the request must be audited, null otherwise.
   */
  private auditableUserId(): string | null {
    const userId = this.clsService.get("userId");
    if (!userId) return null;
    if (this.isAdministrator()) return null;
    return userId;
  }

  /**
   * An audit failure must never fail the request or crash the process: log it and move on.
   */
  private async safeCreateEntry(params: Parameters<AuditRepository["createEntry"]>[0]): Promise<void> {
    try {
      await this.auditRepository.createEntry(params);
    } catch (error) {
      const message = `Audit ${params.action} failed for ${params.entityType} ${params.entityId}`;
      if (this.logger) this.logger.error(message, error as Error, AuditService.name);
      else new Logger(AuditService.name).error(message, (error as Error)?.stack);
    }
  }

  async logCreate(params: { entityType: string; entityId: string }): Promise<void> {
    const userId = this.auditableUserId();
    if (!userId) return;

    await this.safeCreateEntry({
      userId,
      companyId: this.clsService.get("companyId") ?? null,
      ipAddress: this.clsService.get("ipAddress") ?? "",
      action: "create",
      entityType: params.entityType,
      entityId: params.entityId,
      fieldName: null,
      oldValue: null,
      newValue: null,
    });
  }

  async logRead(params: { entityType: string; entityId: string }): Promise<void> {
    const userId = this.auditableUserId();
    if (!userId) return;

    await this.safeCreateEntry({
      userId,
      companyId: this.clsService.get("companyId") ?? null,
      ipAddress: this.clsService.get("ipAddress") ?? "",
      action: "read",
      entityType: params.entityType,
      entityId: params.entityId,
      fieldName: null,
      oldValue: null,
      newValue: null,
    });
  }

  async logUpdate(params: {
    entityType: string;
    entityId: string;
    before: any;
    after: Record<string, any>;
    descriptor: EntityDescriptor<any, any>;
  }): Promise<void> {
    const userId = this.auditableUserId();
    if (!userId) return;

    const changes = this.diffChanges(params.before, params.after, params.descriptor);
    if (changes.length === 0) return;

    const companyId = this.clsService.get("companyId") ?? null;
    const ipAddress = this.clsService.get("ipAddress") ?? "";

    for (const change of changes) {
      await this.safeCreateEntry({
        userId,
        companyId,
        ipAddress,
        action: change.isStatusChange ? "status_change" : "update",
        entityType: params.entityType,
        entityId: params.entityId,
        fieldName: change.fieldName,
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
    }
  }

  async logDelete(params: {
    entityType: string;
    entityId: string;
    snapshot: any;
    descriptor: EntityDescriptor<any, any>;
  }): Promise<void> {
    const userId = this.auditableUserId();
    if (!userId) return;

    const snapshotStr = this.snapshotEntity(params.snapshot, params.descriptor);

    await this.safeCreateEntry({
      userId,
      companyId: this.clsService.get("companyId") ?? null,
      ipAddress: this.clsService.get("ipAddress") ?? "",
      action: "delete",
      entityType: params.entityType,
      entityId: params.entityId,
      fieldName: null,
      oldValue: snapshotStr,
      newValue: null,
    });
  }

  async findByEntity(params: { entityType: string; entityId: string; query: any }): Promise<any> {
    const paginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      auditLogModel,
      await this.auditRepository.findByEntity({
        entityType: params.entityType,
        entityId: params.entityId,
        companyId: this.clsService.get("companyId") ?? null,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findByUser(params: { query: any; userId: string }): Promise<any> {
    const paginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      auditLogModel,
      await this.auditRepository.findByUser({
        userId: params.userId,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  private diffChanges(before: any, after: Record<string, any>, descriptor: EntityDescriptor<any, any>): AuditChange[] {
    const changes: AuditChange[] = [];

    // Diff attribute fields
    for (const fieldName of descriptor.fieldNames) {
      if (!(fieldName in after)) continue;

      const oldVal = before[fieldName];
      const newVal = after[fieldName];
      const oldStr = this.stringify(oldVal);
      const newStr = this.stringify(newVal);

      if (oldStr !== newStr) {
        changes.push({
          fieldName,
          oldValue: oldStr,
          newValue: newStr,
          isStatusChange: fieldName === "status",
        });
      }
    }

    // Diff relationships
    for (const [relationshipKey, _relationshipDef] of Object.entries(descriptor.relationships)) {
      if (!(relationshipKey in after)) continue;

      const oldRel = before[relationshipKey];
      const newRel = after[relationshipKey];

      // Extract ID from old relationship (could be object with .id or just a string)
      const oldId = typeof oldRel === "object" && oldRel !== null ? oldRel.id : oldRel;
      const newId = typeof newRel === "object" && newRel !== null ? newRel.id : newRel;

      const oldStr = this.stringify(oldId);
      const newStr = this.stringify(newId);

      if (oldStr !== newStr) {
        changes.push({
          fieldName: relationshipKey,
          oldValue: oldStr,
          newValue: newStr,
          isStatusChange: false,
        });
      }
    }

    return changes;
  }

  private snapshotEntity(entity: any, descriptor: EntityDescriptor<any, any>): string {
    const snapshot: Record<string, any> = {};
    for (const fieldName of descriptor.fieldNames) {
      snapshot[fieldName] = entity[fieldName] ?? null;
    }
    return JSON.stringify(snapshot);
  }

  private stringify(value: any): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }
}
