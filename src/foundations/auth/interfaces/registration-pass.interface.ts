/**
 * Outcome of checking a registration pass for a provider user.
 * - `valid`: the pass lets this provider user register.
 * - `mismatch`: the pass exists but belongs to a different provider user.
 * - `invalid`: the pass is missing, expired or no longer usable.
 */
export type RegistrationPassVerdict = "valid" | "mismatch" | "invalid";

/**
 * Optional hook an application provides to let a specific provider user register
 * (for example, skipping the waitlist) by carrying a "pass" through OAuth.
 * Applications that provide no hook keep the default registration behaviour.
 */
export interface RegistrationPassInterface {
  /** Whether this pass lets this provider user register. */
  validate(params: { pass: string; provider: "discord"; providerUserId: string }): Promise<RegistrationPassVerdict>;
  /** Called once the account exists; the pass cannot be reused. */
  consume(params: { pass: string }): Promise<void>;
}

/**
 * Injection token for the optional registration pass hook
 */
export const REGISTRATION_PASS = "REGISTRATION_PASS";
