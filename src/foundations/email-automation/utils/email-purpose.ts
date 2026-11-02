/**
 * Why an automation or a blast is sent.
 *
 * - `service`: information about the thing the person signed up for (their waitlist spot, their
 *   account). Reaches everyone; marketing consent and the global opt-out are not checked.
 * - `marketing`: anything that promotes the product. Reaches only people with marketing consent
 *   who are not in the global opt-out list.
 */
export const EMAIL_PURPOSES = ["service", "marketing"] as const;

export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

/**
 * The purpose a stored value counts as: `"service"` only for exactly `"service"`; a missing or
 * unknown value counts as `"marketing"`.
 */
export function resolveEmailPurpose(value: unknown): EmailPurpose {
  return value === "service" ? "service" : "marketing";
}

export type EmailAutomationIneligibleReason = "already_enrolled" | "opted_out" | "no_consent";

/**
 * The one eligibility rule for entering an automation, shared by the trigger, the candidates
 * search and the manual add. Returns why the person cannot enter, or null when they can.
 * Order: already enrolled (any purpose), then, for Marketing only, opted out, then no consent.
 */
export function emailAutomationIneligibleReason(params: {
  purpose: EmailPurpose;
  marketingConsent: boolean;
  optedOut: boolean;
  alreadyEnrolled: boolean;
}): EmailAutomationIneligibleReason | null {
  if (params.alreadyEnrolled) return "already_enrolled";
  if (params.purpose === "service") return null;
  if (params.optedOut) return "opted_out";
  if (!params.marketingConsent) return "no_consent";
  return null;
}
