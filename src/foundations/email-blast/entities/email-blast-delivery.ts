import { Entity, defineEntity } from "../../../common";
import type { EmailBlast } from "./email-blast";
import { emailBlastDeliveryMeta } from "./email-blast-delivery.meta";
import { emailBlastMeta } from "./email-blast.meta";

export type EmailBlastDeliveryStatus = "pending" | "sending" | "sent" | "skipped" | "failed";

/**
 * One recipient of one blast. `userId` is a plain field, never an edge to the User
 * (owner-approved, Carlo 2026-10-27): the delivery outlives the account it was sent to.
 */
export type EmailBlastDelivery = Entity & {
  email: string;
  name?: string;
  userId: string;
  status: EmailBlastDeliveryStatus;
  unsubscribeToken: string;
  claimedAt?: Date;
  sentAt?: Date;
  unsubscribedAt?: Date;
  error?: string;
  blast?: EmailBlast;
};

export const EmailBlastDeliveryDescriptor = defineEntity<EmailBlastDelivery>()({
  ...emailBlastDeliveryMeta,

  // Deliveries belong to a (non company-scoped) blast
  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    email: { type: "string", required: true },
    name: { type: "string" },
    userId: { type: "string", required: true },
    status: { type: "string", required: true },
    unsubscribeToken: { type: "string", required: true },
    claimedAt: { type: "datetime" },
    sentAt: { type: "datetime" },
    unsubscribedAt: { type: "datetime" },
    error: { type: "string" },
  },

  relationships: {
    blast: {
      model: emailBlastMeta,
      direction: "in",
      relationship: "HAS_DELIVERY",
      cardinality: "one",
      required: true,
      dtoKey: "blast",
    },
  },
});

export type EmailBlastDeliveryDescriptorType = typeof EmailBlastDeliveryDescriptor;
