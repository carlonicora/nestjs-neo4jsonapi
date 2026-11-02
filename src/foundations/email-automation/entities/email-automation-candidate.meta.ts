import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * A user or waitlist entry an administrator can add to an automation by hand. Never stored as a
 * node: nodeName is the alias the candidate queries return the User or Waitlist node under.
 */
export const emailAutomationCandidateMeta: DataMeta = {
  type: "email-automation-candidates",
  endpoint: "email-automation-candidates",
  nodeName: "emailAutomationCandidate",
  labelName: "EmailAutomationCandidate",
};
