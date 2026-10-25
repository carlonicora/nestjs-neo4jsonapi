/**
 * The offer the credit warning makes, chosen once when the warning fires so the
 * banner and the email always agree.
 *
 * - `subscribe`: the company is on a trial
 * - `upgrade-or-pack`: an active recurring plan with more credits exists in the same interval
 * - `pack`: no bigger plan exists, so only a credit pack is offered
 */
export type CreditWarningOffer = "subscribe" | "upgrade-or-pack" | "pack";

/**
 * Route segment of the dismiss endpoint, appended to `${companyMeta.endpoint}/:companyId/`.
 * The frontend library declares the same value; a spec in each package asserts it.
 */
export const CREDIT_WARNING_DISMISS_SEGMENT = "credit-warning/dismiss";
