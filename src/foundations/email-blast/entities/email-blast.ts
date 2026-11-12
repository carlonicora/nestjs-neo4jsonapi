import { Entity, defineEntity } from "../../../common";
import { EmailPurpose } from "../../email-automation/utils/email-purpose";
import { emailBlastMeta } from "./email-blast.meta";

export type EmailBlastStatus = "draft" | "sending" | "sent";

export type EmailBlast = Entity & {
  subject: string;
  body: string;
  replyTo?: string;
  /** Missing counts as "marketing" (see resolveEmailPurpose). */
  purpose?: EmailPurpose;
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
    subject: { type: "string", required: true, sortable: true },
    body: { type: "string", required: true },
    replyTo: { type: "string" },
    purpose: { type: "string", sortable: true },
    // Not required: the POST DTO never carries it, the default sets it
    status: { type: "string", default: "draft", sortable: true },
    sentAt: { type: "datetime", sortable: true },
    recipientCount: { type: "number" },
    sentCount: { type: "number", default: 0, sortable: true },
    failedCount: { type: "number", default: 0, sortable: true },
    unsubscribedCount: { type: "number", default: 0, sortable: true },
  },

  relationships: {},
});

export type EmailBlastDescriptorType = typeof EmailBlastDescriptor;
