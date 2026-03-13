import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { AuditLog } from "./audit.entity";
import { auditLogMeta } from "./audit.meta";

export const mapAuditLog = (params: { data: any; record: any; entityFactory: EntityFactory }): AuditLog => {
  const isAuditLog = !params.data.labels || params.data.labels.includes(auditLogMeta.labelName);

  return {
    ...mapEntity({ record: params.data }),
    kind: isAuditLog ? "audit" : "comment",
    action: isAuditLog ? params.data.action : undefined,
    entity_type: isAuditLog ? params.data.entity_type : undefined,
    entity_id: isAuditLog ? params.data.entity_id : undefined,
    field_name: isAuditLog ? (params.data.field_name ?? undefined) : undefined,
    old_value: isAuditLog ? (params.data.old_value ?? undefined) : undefined,
    new_value: isAuditLog ? (params.data.new_value ?? undefined) : undefined,
    ip_address: isAuditLog ? (params.data.ip_address ?? undefined) : undefined,
    company_id: isAuditLog ? (params.data.company_id ?? undefined) : undefined,
    content: isAuditLog ? undefined : params.data.content,
    annotation_id: isAuditLog ? undefined : params.data.id,

    user: undefined,
    audited: undefined,
  };
};
