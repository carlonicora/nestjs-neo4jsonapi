import { Entity, defineEntity } from "../../../common";
import type { EmailAutomationStep } from "./email-automation-step";
import { emailAutomationStepMeta } from "./email-automation-step.meta";
import { emailAutomationMeta } from "./email-automation.meta";

export type EmailAutomation = Entity & {
  name: string;
  trigger?: string;
  exitTrigger?: string;
  replyTo?: string;
  isActive: boolean;
  stepCount?: number; // computed
  activeCount?: number; // computed
  completedCount?: number; // computed
  unsubscribedCount?: number; // computed
  steps?: EmailAutomationStep[];
};

/**
 * Reads a count column produced by `EmailAutomationRepository.buildReturnStatement()`.
 * The column only exists when the automation is the root of the query; as an
 * included resource the stored value (normally absent) is kept.
 */
const countFromRecord = (column: keyof EmailAutomation & string) => ({
  compute: (params: { record: any; data: any }) => {
    if (!params.record?.has?.(column)) return params.data?.[column];
    const count = params.record.get(column);
    if (count?.toNumber) return count.toNumber();
    return Number(count) || 0;
  },
});

export const EmailAutomationDescriptor = defineEntity<EmailAutomation>()({
  ...emailAutomationMeta,

  // Email automations are NOT company-scoped - administrators manage them for the whole app
  isCompanyScoped: false,

  fields: {
    name: { type: "string", required: true },
    trigger: { type: "string" },
    exitTrigger: { type: "string" },
    replyTo: { type: "string" },
    isActive: { type: "boolean", required: true, default: false },
    stepCount: { type: "number" },
    activeCount: { type: "number" },
    completedCount: { type: "number" },
    unsubscribedCount: { type: "number" },
  },

  computed: {
    stepCount: countFromRecord("stepCount"),
    activeCount: countFromRecord("activeCount"),
    completedCount: countFromRecord("completedCount"),
    unsubscribedCount: countFromRecord("unsubscribedCount"),
  },

  relationships: {
    steps: {
      model: emailAutomationStepMeta,
      direction: "out",
      relationship: "HAS_STEP",
      cardinality: "many",
      required: false,
      dtoKey: "steps",
    },
  },
});

export type EmailAutomationDescriptorType = typeof EmailAutomationDescriptor;
