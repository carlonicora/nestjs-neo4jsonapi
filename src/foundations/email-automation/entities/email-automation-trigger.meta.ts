import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * Synthetic resource: the triggers an app declares in its config. Never stored as a node.
 */
export const emailAutomationTriggerMeta: DataMeta = {
  type: "email-automation-triggers",
  endpoint: "email-automation-triggers",
  nodeName: "emailAutomationTrigger",
  labelName: "EmailAutomationTrigger",
};
