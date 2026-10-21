import { DataMeta } from "../../../common/interfaces/datamodel.interface";

export const emailAutomationMeta: DataMeta = {
  type: "email-automations",
  endpoint: "email-automations",
  nodeName: "emailAutomation",
  labelName: "EmailAutomation",
};

/** Path segment of the public unsubscribe route: `${emailAutomationMeta.endpoint}/${EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT}/:token`. */
export const EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT = "unsubscribe";

/** JSON:API `type` of the public unsubscribe request body. */
export const EMAIL_AUTOMATION_UNSUBSCRIBE_TYPE = "email-automation-unsubscribes";
