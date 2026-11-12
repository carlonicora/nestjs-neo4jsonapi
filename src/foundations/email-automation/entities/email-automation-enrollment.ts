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
  recipientMarketingConsent?: boolean; // computed: the recipient record's current consent
  automation?: EmailAutomation;
  currentStep?: EmailAutomationStep;
  sentSteps?: EmailAutomationStep[];
};

export const EmailAutomationEnrollmentDescriptor = defineEntity<EmailAutomationEnrollment>()({
  ...emailAutomationEnrollmentMeta,

  // Enrolments belong to a (non company-scoped) email automation
  isCompanyScoped: false,

  fields: {
    email: { type: "string", required: true, sortable: true },
    name: { type: "string", sortable: true },
    recipientType: { type: "string", required: true },
    recipientId: { type: "string", required: true },
    status: { type: "string", required: true, default: "active", sortable: true },
    enrolledAt: { type: "datetime", required: true },
    nextSendAt: { type: "datetime", sortable: true },
    finishedAt: { type: "datetime" },
    attempts: { type: "number", required: true, default: 0 },
    lastError: { type: "string" },
    unsubscribeToken: { type: "string", excludeFromJsonApi: true, excludeFromSearch: true },
    currentStepSubject: { type: "string" },
    sentCount: { type: "number" },
    // Internal: the sender reads it from the entity; never serialised (the public unsubscribe answer included).
    recipientMarketingConsent: { type: "boolean", excludeFromJsonApi: true },
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
    // Column produced by EmailAutomationEnrollmentRepository.buildReturnStatement(): the consent
    // on the recipient's record right now (false when the record no longer exists).
    recipientMarketingConsent: {
      compute: (params) => {
        if (!params.record?.has?.("recipientMarketingConsent")) return params.data?.recipientMarketingConsent;
        return params.record.get("recipientMarketingConsent") === true;
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
