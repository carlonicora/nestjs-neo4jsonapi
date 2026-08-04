export type RegistrationMode = "open" | "closed" | "waitlist";

export interface ConfigAuthInterface {
  allowRegistration: boolean;
  registrationMode: RegistrationMode;

  /**
   * Locale used for transactional auth emails (activation, password reset,
   * admin registration notification) and for the `<locale>/…` prefix of the
   * links inside them. Defaults to "en" when not set, which is the value the
   * flows were previously hardcoded to.
   */
  emailLocale?: string;
}
