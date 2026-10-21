/**
 * The person a trigger enrols: built by `EmailAutomationTriggerDefinition.toRecipient`
 * from the event payload.
 */
export type EmailAutomationRecipient = {
  email: string;
  name?: string;
  recipientType: "user" | "waitlist";
  recipientId: string;
  marketingConsent: boolean;
};

/**
 * One trigger an app declares. The library holds no app trigger key: every key and
 * label comes from the consuming app (see `waitlistConfirmedTrigger` /
 * `userActivatedTrigger` for the built-in events).
 */
export interface EmailAutomationTriggerDefinition {
  /** Stable key stored on `EmailAutomation.trigger` / `exitTrigger` */
  key: string;
  /** Plain-text label shown to administrators */
  label: string;
  /** `EventEmitter2` event name the trigger listens to */
  event: string;
  /** Maps the event payload to a recipient; null skips the event */
  toRecipient: (payload: unknown) => EmailAutomationRecipient | null;
}

/**
 * Configuration interface for the EmailAutomationModule.
 *
 * Every option is optional and defaults to the inert value: with no triggers the
 * module mounts its admin and unsubscribe routes, but nobody is ever enrolled.
 */
export interface EmailAutomationModuleConfig {
  /**
   * The triggers administrators can pick as an automation's entry or exit.
   *
   * @default []
   */
  triggers?: EmailAutomationTriggerDefinition[];
}

/**
 * Default configuration values.
 */
export const DEFAULT_EMAIL_AUTOMATION_CONFIG: Required<EmailAutomationModuleConfig> = {
  triggers: [],
};

/**
 * Injection token for the merged EmailAutomationModule configuration.
 */
export const EMAIL_AUTOMATION_CONFIG = Symbol("EMAIL_AUTOMATION_CONFIG");
