import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { AuditLog } from "./audit.entity";

export const mapAuditLog = (params: { data: any; record: any; entityFactory: EntityFactory }): AuditLog => {
  const isAnnotation = params.data.labels?.includes("Annotation");

  return {
    ...mapEntity({ record: params.data }),
    kind: isAnnotation ? "comment" : "audit",
    action: isAnnotation ? undefined : params.data.action,
    entity_type: isAnnotation ? undefined : params.data.entity_type,
    entity_id: isAnnotation ? undefined : params.data.entity_id,
    field_name: isAnnotation ? undefined : (params.data.field_name ?? undefined),
    old_value: isAnnotation ? undefined : (params.data.old_value ?? undefined),
    new_value: isAnnotation ? undefined : (params.data.new_value ?? undefined),
    ip_address: isAnnotation ? undefined : (params.data.ip_address ?? undefined),
    company_id: isAnnotation ? undefined : (params.data.company_id ?? undefined),
    content: isAnnotation ? params.data.content : undefined,
    annotation_id: isAnnotation ? params.data.id : undefined,

    user: undefined,
    audited: undefined,
  };
};
