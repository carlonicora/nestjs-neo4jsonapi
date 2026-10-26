export const ACCOUNT_DELETION_LOGIN_HOOK = Symbol("ACCOUNT_DELETION_LOGIN_HOOK");

/**
 * Called by `AuthService.createAuth` on every fresh login (never on refresh)
 * when the app opts into account deletion.
 */
export interface AccountDeletionLoginHook {
  /** Clears a pending deletion request. True when one was cleared. */
  cancelOnLogin(params: { userId: string }): Promise<boolean>;
}
