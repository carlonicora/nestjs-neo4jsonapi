/**
 * How a Referral came about: through the referrer's invite link, or recorded
 * directly by the app (e.g. a player who later became a GM).
 */
export const REFERRAL_SOURCE = { link: "link", direct: "direct" } as const;
export type ReferralSource = (typeof REFERRAL_SOURCE)[keyof typeof REFERRAL_SOURCE];
