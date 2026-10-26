export const ACCOUNT_DELETION_HANDLER = Symbol("ACCOUNT_DELETION_HANDLER");

export interface AccountDeletionImpact {
  ownedCount: number;
  otherTables: string[];
}

/**
 * App hook of the account-deletion feature: the app's own content. Optional;
 * without it the preview reports no owned content and the wipe runs the
 * generic library steps only.
 */
export interface AccountDeletionHandler {
  /** What the confirmation dialog lists: own campaigns (only when the company goes) and other GMs' campaign names. */
  describeImpact(params: {
    userId: string;
    companyId?: string;
    deletesCompany: boolean;
  }): Promise<AccountDeletionImpact>;
  /** The user's traces in every company except `wipedCompanyId`. Runs while the User and its DiscordUser still exist. Idempotent. */
  removeUserTraces(params: { userId: string; wipedCompanyId?: string }): Promise<void>;
  /** App content of a company about to be wiped. Runs before the generic sweep. Idempotent. */
  deleteCompanyContent(params: { companyId: string; actingUserId?: string }): Promise<void>;
}
