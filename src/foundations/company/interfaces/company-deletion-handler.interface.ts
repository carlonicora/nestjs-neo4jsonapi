/**
 * Reason for company deletion - used to customize email notifications.
 */
export type DeletionReason = "trial_expired" | "subscription_cancelled" | "immediate_deletion";

/**
 * Options for company deletion.
 */
export interface DeletionOptions {
  /** Whether to send a confirmation email to the company owner */
  sendEmail?: boolean;
  /** The reason for deletion - determines email content */
  reason?: DeletionReason;
}

/**
 * Interface for comprehensive company deletion.
 *
 * Allows consuming applications to provide their own deletion implementation
 * that handles app-specific cleanup (S3, additional relationships, audit logging).
 *
 * Use with @Optional() @Inject(COMPANY_DELETION_HANDLER) to make it optional.
 */
export interface CompanyDeletionHandler {
  /**
   * Perform comprehensive company deletion.
   *
   * @param companyId - The company ID to delete
   * @param companyName - The company name (for audit logging)
   * @param options - Optional deletion options (email notification, reason)
   * @returns Promise that resolves when deletion is complete
   */
  deleteCompany(companyId: string, companyName: string, options?: DeletionOptions): Promise<void>;
}

/**
 * Injection token for optional company deletion handler.
 * If not provided, the default simple deletion will be used.
 */
export const COMPANY_DELETION_HANDLER = Symbol("COMPANY_DELETION_HANDLER");
