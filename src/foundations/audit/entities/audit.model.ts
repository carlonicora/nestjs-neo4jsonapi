import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { AuditLog } from "./audit.entity";
import { mapAuditLog } from "./audit.map";
import { auditLogMeta } from "./audit.meta";
import { AuditSerialiser } from "../serialisers/audit.serialiser";
import { userMeta } from "../../user/entities/user.meta";

export const auditLogModel: DataModelInterface<AuditLog> = {
  ...auditLogMeta,
  entity: undefined as unknown as AuditLog,
  mapper: mapAuditLog,
  serialiser: AuditSerialiser,
  singleChildrenTokens: [userMeta.nodeName],
  dynamicSingleChildrenPatterns: ["{parent}_{*}"],
};
