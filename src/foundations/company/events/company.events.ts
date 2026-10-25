/**
 * Event emitted when a company's plan stops carrying AI.
 *
 * Decouples the flag write from any consumer that reacts to it (narr8 discards
 * the whole credit backlog), so the library never has to know about an
 * application's backlog service. Mirrors TOKEN_USAGE_RECORDED_EVENT.
 */
export const COMPANY_AI_DISABLED_EVENT = "company.ai_disabled";

export interface CompanyAiDisabledPayload {
  companyId: string;
}

/**
 * Event emitted after credits are deducted from a company's balances.
 *
 * Carries the balances AFTER the deduction. Emitted before the
 * `company:credits_updated` websocket push, so a failed push never drops it.
 */
export const COMPANY_CREDITS_USED_EVENT = "company.credits_used";

export interface CompanyCreditsUsedPayload {
  companyId: string;
  availableMonthlyCredits: number;
  availableExtraCredits: number;
}

/**
 * Event emitted when a company receives its monthly credit grant (renewal,
 * trial grant, plan change). Marks the start of a new credit period. Buying a
 * credit pack does NOT emit it.
 */
export const COMPANY_CREDITS_GRANTED_EVENT = "company.credits_granted";

export interface CompanyCreditsGrantedPayload {
  companyId: string;
  grantedCredits: number;
}
