import { Entity, defineEntity } from "../../../common";
import { emailOptOutMeta } from "./email-opt-out.meta";

export type EmailOptOut = Entity & {
  email: string;
  optedOutAt: Date;
  source: "link" | "header";
};

export const EmailOptOutDescriptor = defineEntity<EmailOptOut>()({
  ...emailOptOutMeta,

  // Opt-outs are per email address, across the whole app
  isCompanyScoped: false,

  fields: {
    email: { type: "string", required: true },
    optedOutAt: { type: "datetime", required: true },
    source: { type: "string", required: true },
  },

  relationships: {},
});

export type EmailOptOutDescriptorType = typeof EmailOptOutDescriptor;
