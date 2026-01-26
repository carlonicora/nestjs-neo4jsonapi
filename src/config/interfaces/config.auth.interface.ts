export type RegistrationMode = "open" | "closed" | "waitlist";

export interface ConfigAuthInterface {
  allowRegistration: boolean;
  registrationMode: RegistrationMode;
}
