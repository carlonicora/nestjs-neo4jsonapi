import { Entity, defineEntity } from "../../../common";
import { emailAutomationTriggerMeta } from "./email-automation-trigger.meta";

/**
 * Synthetic resource built from the app's trigger config (`id` = `key`); never a node.
 */
export type EmailAutomationTrigger = Entity & {
  key: string;
  label: string;
};

export const EmailAutomationTriggerDescriptor = defineEntity<EmailAutomationTrigger>()({
  ...emailAutomationTriggerMeta,
  isCompanyScoped: false,
  fields: {
    key: { type: "string", required: true },
    label: { type: "string", required: true },
  },
  relationships: {},
});

export type EmailAutomationTriggerDescriptorType = typeof EmailAutomationTriggerDescriptor;
