import { Entity, defineEntity } from "../../../common";
import type { EmailAutomation } from "./email-automation";
import { emailAutomationStepMeta } from "./email-automation-step.meta";
import { emailAutomationMeta } from "./email-automation.meta";

export type EmailAutomationStep = Entity & {
  subject: string;
  body: string;
  delayHours: number;
  positionX?: number;
  positionY?: number;
  sentCount?: number; // computed
  automation?: EmailAutomation;
  next?: EmailAutomationStep;
};

export const EmailAutomationStepDescriptor = defineEntity<EmailAutomationStep>()({
  ...emailAutomationStepMeta,

  // Steps belong to a (non company-scoped) email automation
  isCompanyScoped: false,

  fields: {
    subject: { type: "string", required: true },
    body: { type: "string", required: true },
    delayHours: { type: "number", required: true, default: 24 },
    positionX: { type: "number" },
    positionY: { type: "number" },
    sentCount: { type: "number" },
  },

  computed: {
    sentCount: {
      compute: (params) => {
        // A step is also returned as an included resource (`next`, an enrolment's
        // `currentStep`), and the record is shared with the root. The root step reads
        // `sentCount`; an included step reads `<alias>_sentCount`, so it never picks up
        // the root's (or an enrolment's) count.
        const column =
          !params.name || params.name === emailAutomationStepMeta.nodeName ? "sentCount" : `${params.name}_sentCount`;
        if (!params.record?.has?.(column)) return params.data?.sentCount;
        const count = params.record.get(column);
        if (count?.toNumber) return count.toNumber();
        return Number(count) || 0;
      },
    },
  },

  relationships: {
    automation: {
      model: emailAutomationMeta,
      direction: "in",
      relationship: "HAS_STEP",
      cardinality: "one",
      required: true,
      dtoKey: "automation",
    },
    next: {
      model: emailAutomationStepMeta,
      direction: "out",
      relationship: "NEXT",
      cardinality: "one",
      required: false,
      dtoKey: "next",
    },
  },
});

export type EmailAutomationStepDescriptorType = typeof EmailAutomationStepDescriptor;
