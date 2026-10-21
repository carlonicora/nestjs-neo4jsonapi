import { Entity, defineEntity } from "../../../common";
import type { EmailAutomation } from "./email-automation";
import type { EmailAutomationStep } from "./email-automation-step";
import { emailAutomationEnrollmentMeta } from "./email-automation-enrollment.meta";
import { emailAutomationStepMeta } from "./email-automation-step.meta";
import { emailAutomationMeta } from "./email-automation.meta";

export type EmailAutomationEnrollmentStatus = "active" | "completed" | "unsubscribed" | "exited" | "failed";

export type EmailAutomationEnrollment = Entity & {
  email: string;
  name?: string;
  recipientType: "user" | "waitlist";
  recipientId: string;
  status: EmailAutomationEnrollmentStatus;
  enrolledAt: Date;
  nextSendAt?: Date;
  finishedAt?: Date;
  attempts: number;
  lastError?: string;
  unsubscribeToken?: string;
  currentStepSubject?: string; // computed
  sentCount?: number; // computed
  automation?: EmailAutomation;
  currentStep?: EmailAutomationStep;
  sentSteps?: EmailAutomationStep[];
};

export const EmailAutomationEnrollmentDescriptor = defineEntity<EmailAutomationEnrollment>()({
  ...emailAutomationEnrollmentMeta,

  // Enrolments belong to a (non company-scoped) email automation
  isCompanyScoped: false,

  fields: {
    email: { type: "string", required: true },
    name: { type: "string" },
    recipientType: { type: "string", required: true },
    recipientId: { type: "string", required: true },
    status: { type: "string", required: true, default: "active" },
    enrolledAt: { type: "datetime", required: true },
    nextSendAt: { type: "datetime" },
    finishedAt: { type: "datetime" },
    attempts: { type: "number", required: true, default: 0 },
    lastError: { type: "string" },
    unsubscribeToken: { type: "string", excludeFromJsonApi: true, excludeFromSearch: true },
    currentStepSubject: { type: "string" },
    sentCount: { type: "number" },
  },

  computed: {
    currentStepSubject: {
      compute: (params) => {
        if (!params.record?.has?.("currentStepSubject")) return params.data?.currentStepSubject;
        return params.record.get("currentStepSubject") ?? undefined;
      },
    },
    sentCount: {
      compute: (params) => {
        if (!params.record?.has?.("sentCount")) return params.data?.sentCount;
        const count = params.record.get("sentCount");
        if (count?.toNumber) return count.toNumber();
        return Number(count) || 0;
      },
    },
  },

  relationships: {
    automation: {
      model: emailAutomationMeta,
      direction: "in",
      relationship: "HAS_ENROLLMENT",
      cardinality: "one",
      required: true,
      dtoKey: "automation",
    },
    currentStep: {
      model: emailAutomationStepMeta,
      direction: "out",
      relationship: "AT_STEP",
      cardinality: "one",
      required: false,
      dtoKey: "currentStep",
    },
    sentSteps: {
      model: emailAutomationStepMeta,
      direction: "out",
      relationship: "SENT",
      cardinality: "many",
      required: false,
      dtoKey: "sentSteps",
      fields: [{ name: "sentAt", type: "datetime", required: true }],
    },
  },
});

export type EmailAutomationEnrollmentDescriptorType = typeof EmailAutomationEnrollmentDescriptor;
