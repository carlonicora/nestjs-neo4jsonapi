import { USER_ACTIVATED_EVENT, UserActivatedEvent } from "../../auth/events/auth.events";
import { WAITLIST_CONFIRMED_EVENT, WaitlistConfirmedEvent } from "../../waitlist/events/waitlist.events";
import {
  EmailAutomationRecipient,
  EmailAutomationTriggerDefinition,
} from "../interfaces/email-automation.config.interface";

/**
 * Trigger fired when a waitlist entry is confirmed. The app chooses the key and the label.
 */
export function waitlistConfirmedTrigger(key: string, label = "Waitlist confirmed"): EmailAutomationTriggerDefinition {
  return {
    key,
    label,
    event: WAITLIST_CONFIRMED_EVENT,
    toRecipient: (payload: unknown): EmailAutomationRecipient | null => {
      const waitlist = (payload as Partial<WaitlistConfirmedEvent> | undefined)?.waitlist;
      if (!waitlist?.id || !waitlist.email) return null;

      return {
        email: waitlist.email,
        recipientType: "waitlist",
        recipientId: waitlist.id,
        marketingConsent: waitlist.marketingConsent === true,
      };
    },
  };
}

/**
 * Trigger fired when a user completes registration. The app chooses the key and the label.
 */
export function userActivatedTrigger(key: string, label = "Registration completed"): EmailAutomationTriggerDefinition {
  return {
    key,
    label,
    event: USER_ACTIVATED_EVENT,
    toRecipient: (payload: unknown): EmailAutomationRecipient | null => {
      const user = (payload as Partial<UserActivatedEvent> | undefined)?.user;
      if (!user?.id || !user.email) return null;

      return {
        email: user.email,
        name: user.name || undefined,
        recipientType: "user",
        recipientId: user.id,
        marketingConsent: user.marketingConsent === true,
      };
    },
  };
}
