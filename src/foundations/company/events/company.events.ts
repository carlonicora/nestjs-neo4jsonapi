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
