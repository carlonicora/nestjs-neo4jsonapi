import { Entity, defineEntity } from "../../../common";
import { emailBlastAudienceMeta } from "./email-blast-audience.meta";

/**
 * Synthetic resource (`id` = the blast id): how many people the blast would reach. Never a node.
 */
export type EmailBlastAudience = Entity & {
  recipientCount: number;
};

export const EmailBlastAudienceDescriptor = defineEntity<EmailBlastAudience>()({
  ...emailBlastAudienceMeta,
  isCompanyScoped: false,
  tenancy: "internal",
  fields: {
    recipientCount: { type: "number", required: true },
  },
  relationships: {},
});

export type EmailBlastAudienceDescriptorType = typeof EmailBlastAudienceDescriptor;
