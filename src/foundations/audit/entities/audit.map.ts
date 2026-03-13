import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { AuditLog } from "./audit.entity";

export const mapAuditLog = (params: { data: any; record: any; entityFactory: EntityFactory }): AuditLog => {
  return {
    ...mapEntity({ record: params.data }),
    action: params.data.action,
    entity_type: params.data.entity_type,
    entity_id: params.data.entity_id,
    field_name: params.data.field_name ?? undefined,
    old_value: params.data.old_value ?? undefined,
    new_value: params.data.new_value ?? undefined,
    ip_address: params.data.ip_address ?? undefined,
    company_id: params.data.company_id ?? undefined,

    user: undefined,
    audited: undefined,
  };
};
