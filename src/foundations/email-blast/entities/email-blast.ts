import { Entity, defineEntity } from "../../../common";
import { emailBlastMeta } from "./email-blast.meta";

export type EmailBlastStatus = "draft" | "sending" | "sent";

export type EmailBlast = Entity & {
  subject: string;
  body: string;
  replyTo?: string;
  status: EmailBlastStatus;
  sentAt?: Date;
  recipientCount?: number;
  sentCount: number;
  failedCount: number;
  unsubscribedCount: number;
};

export const EmailBlastDescriptor = defineEntity<EmailBlast>()({
  ...emailBlastMeta,

  // Blasts are NOT company-scoped: administrators send them to the whole app
  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    subject: { type: "string", required: true },
    body: { type: "string", required: true },
    replyTo: { type: "string" },
    // Not required: the POST DTO never carries it, the default sets it
    status: { type: "string", default: "draft" },
    sentAt: { type: "datetime" },
    recipientCount: { type: "number" },
    sentCount: { type: "number", default: 0 },
    failedCount: { type: "number", default: 0 },
    unsubscribedCount: { type: "number", default: 0 },
  },

  relationships: {},
});

export type EmailBlastDescriptorType = typeof EmailBlastDescriptor;
