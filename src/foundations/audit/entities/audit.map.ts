import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { Audit } from "../../audit/entities/audit.entity";

export const mapAudit = (params: { data: any; record: any; entityFactory: EntityFactory }): Audit => {
  return {
    ...mapEntity({ record: params.data }),
    auditType: params.data.auditType,
    changes: params.data.changes ?? undefined,

    user: undefined,
    // audited: [],
    audited: undefined,
  };
};
