import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * Synthetic resource: the number of people a blast would reach right now. Never stored as a node.
 */
export const emailBlastAudienceMeta: DataMeta = {
  type: "email-blast-audiences",
  endpoint: "email-blast-audiences",
  nodeName: "emailBlastAudience",
  labelName: "EmailBlastAudience",
};
