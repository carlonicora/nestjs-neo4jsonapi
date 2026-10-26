import { JobsOptions } from "bullmq";

/** Job names on `QueueId.ACCOUNT_DELETION`. */
export const ACCOUNT_DELETION_JOB_NAMES = {
  /** Wipe one user (data `AccountDeletionJobData`). Enqueued by the daily cron. */
  deleteAccount: "delete-account",
  /** Wipe one company (data `CompanyWipeJobData`). Enqueued by `FullCompanyDeletionService.deleteCompany`. */
  deleteCompany: "delete-company",
  /** The final "your account has been deleted" email (data `AccountDeletedEmailJobData`). */
  accountDeletedEmail: "account-deleted-email",
} as const;

export interface AccountDeletionJobData {
  userId: string;
}

export interface CompanyWipeJobData {
  companyId: string;
}

export interface AccountDeletedEmailJobData {
  to: string;
  name: string;
  locale: string;
}

/** Options of the `delete-account` and `delete-company` jobs. No payload lingers once a job completes. */
export const ACCOUNT_DELETION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: true,
  removeOnFail: { count: 100 },
};

/**
 * Options of the final email job. A completed email job is kept for three days
 * so its job id still exists when a crashed wipe re-runs (the retry backoff or
 * the next daily cron): BullMQ ignores an add whose job id exists, so the email
 * goes out once. After three days the job, and the address in it, are removed.
 */
export const ACCOUNT_DELETED_EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: 3 * 24 * 60 * 60 },
  removeOnFail: { count: 100 },
};

/** Nodes deleted per transaction by every bulk delete of the wipe. */
export const WIPE_BATCH_SIZE = 1000;

// BullMQ job ids must not contain ":".
export const accountDeletionJobId = (userId: string): string => `account-deletion-${userId}`;
export const companyWipeJobId = (companyId: string): string => `company-deletion-${companyId}`;
export const accountDeletedEmailJobId = (userId: string): string => `account-deleted-email-${userId}`;
