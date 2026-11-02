import { Entity, defineEntity } from "../../../common";
import { EmailAutomationIneligibleReason } from "../utils/email-purpose";
import { emailAutomationCandidateMeta } from "./email-automation-candidate.meta";

/**
 * A person the manual add can enrol, flagged addable or not with the reason. Read from a User or a
 * Waitlist node returned under the candidate alias, so `id` is that node's id (= `recipientId`;
 * UUIDs never collide across the two labels). The node gives `email` and `name`; the query's record
 * columns give `recipientType`, `recipientId`, `marketingConsent`, `optedOut` and
 * `alreadyEnrolled`. `addable` and `reason` are filled by EmailAutomationService. No
 * EmailAutomationCandidate node exists.
 */
export type EmailAutomationCandidate = Entity & {
  recipientType: "user" | "waitlist";
  recipientId: string;
  email: string;
  name?: string;
  marketingConsent: boolean;
  optedOut: boolean;
  alreadyEnrolled: boolean;
  addable: boolean;
  reason?: EmailAutomationIneligibleReason;
};

export const EmailAutomationCandidateDescriptor = defineEntity<EmailAutomationCandidate>()({
  ...emailAutomationCandidateMeta,
  isCompanyScoped: false,
  tenancy: "internal",
  fields: {
    recipientType: { type: "string", required: true },
    recipientId: { type: "string", required: true },
    email: { type: "string", required: true },
    name: { type: "string" },
    marketingConsent: { type: "boolean", required: true },
    optedOut: { type: "boolean", required: true },
    alreadyEnrolled: { type: "boolean", required: true },
    addable: { type: "boolean", required: true },
    reason: { type: "string" },
  },
  computed: {
    recipientType: {
      compute: (params) =>
        params.record?.has?.("recipientType") ? String(params.record.get("recipientType")) : params.data?.recipientType,
    },
    recipientId: {
      compute: (params) =>
        params.record?.has?.("recipientId") ? String(params.record.get("recipientId")) : params.data?.recipientId,
    },
    marketingConsent: {
      compute: (params) =>
        params.record?.has?.("marketingConsent")
          ? params.record.get("marketingConsent") === true
          : params.data?.marketingConsent === true,
    },
    optedOut: {
      compute: (params) =>
        params.record?.has?.("optedOut") ? params.record.get("optedOut") === true : params.data?.optedOut === true,
    },
    alreadyEnrolled: {
      compute: (params) =>
        params.record?.has?.("alreadyEnrolled")
          ? params.record.get("alreadyEnrolled") === true
          : params.data?.alreadyEnrolled === true,
    },
  },
  relationships: {},
});

export type EmailAutomationCandidateDescriptorType = typeof EmailAutomationCandidateDescriptor;
