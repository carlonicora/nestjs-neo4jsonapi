/**
 * Configuration of the opt-in account-deletion feature.
 *
 * Passing `accountDeletion` (even `{}`) to `bootstrap()` /
 * `FoundationsModule.forRoot()` mounts the feature; omitting it mounts nothing.
 */
export interface AccountDeletionModuleConfig {
  /**
   * Days between the request and the wipe. Logging in or the undo link cancels
   * the request inside this window.
   *
   * @default 7
   */
  graceDays?: number;
}

export const DEFAULT_ACCOUNT_DELETION_CONFIG: Required<AccountDeletionModuleConfig> = { graceDays: 7 };

export const ACCOUNT_DELETION_CONFIG = Symbol("ACCOUNT_DELETION_CONFIG");
