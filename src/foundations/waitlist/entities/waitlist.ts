import { Entity, defineEntity } from "../../../common";
import { WaitlistStatus } from "../enums/waitlist-status.enum";
import { waitlistMeta } from "./waitlist.meta";

export { WaitlistStatus } from "../enums/waitlist-status.enum";

export type Waitlist = Entity & {
  email: string;
  gdprConsent: boolean;
  gdprConsentAt: Date;
  marketingConsent?: boolean;
  marketingConsentAt?: Date;
  questionnaire?: string;
  confirmationCode?: string;
  confirmationCodeExpiration?: Date;
  confirmedAt?: Date;
  status: WaitlistStatus;
  inviteCode?: string;
  inviteCodeExpiration?: Date;
  invitedAt?: Date;
  registeredAt?: Date;
  userId?: string;
};

export const WaitlistDescriptor = defineEntity<Waitlist>()({
  ...waitlistMeta,

  // Waitlist entries are NOT company-scoped - they exist before user registration
  isCompanyScoped: false,

  fields: {
    email: { type: "string", required: true },
    gdprConsent: { type: "boolean", required: true },
    gdprConsentAt: { type: "datetime", required: true },
    marketingConsent: { type: "boolean" },
    marketingConsentAt: { type: "datetime" },
    questionnaire: {
      type: "string",
      transform: (data) => (data.questionnaire ? JSON.parse(data.questionnaire) : null),
    },
    confirmationCode: { type: "string", excludeFromJsonApi: true },
    confirmationCodeExpiration: { type: "datetime", excludeFromJsonApi: true },
    confirmedAt: { type: "datetime" },
    status: { type: "string", required: true, default: WaitlistStatus.Pending },
    inviteCode: { type: "string", excludeFromJsonApi: true },
    inviteCodeExpiration: { type: "datetime", excludeFromJsonApi: true },
    invitedAt: { type: "datetime" },
    registeredAt: { type: "datetime" },
    userId: { type: "string" },
  },

  relationships: {},
});

export type WaitlistDescriptorType = typeof WaitlistDescriptor;
