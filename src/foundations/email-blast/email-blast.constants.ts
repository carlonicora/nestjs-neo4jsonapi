import { JobsOptions } from "bullmq";

/** Job names on `QueueId.EMAIL_BLAST`. */
export const EMAIL_BLAST_JOB_NAMES = {
  /** Snapshot the recipients of one blast and send it (data `EmailBlastJobData`). */
  sendBlast: "send-blast",
} as const;

export type EmailBlastJobData = { blastId: string };

/**
 * Options of the `send-blast` job. One attempt: a job retry must never re-run a send; the
 * recovery cron re-enqueues instead, and `removeOnFail` frees the jobId so it can (BullMQ
 * ignores `add` while a job with that id exists in any state).
 */
export const EMAIL_BLAST_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
};

/** The jobId of a blast's send job. Never contains a colon (BullMQ rejects it). */
export function emailBlastJobId(blastId: string): string {
  return `email-blast-${blastId}`;
}

/** Deliveries claimed and sent per batch. */
export const EMAIL_BLAST_BATCH_SIZE = 50;

/**
 * Minutes after which a delivery still in `sending` is failed (never resent). Well above the
 * time one batch can take, so a live batch is never marked stuck.
 */
export const EMAIL_BLAST_STUCK_MINUTES = 60;

/** Unsubscribe token of a test send: it matches no delivery. */
export const EMAIL_BLAST_TEST_TOKEN = "test";

/** Subject prefix of a test send. */
export const EMAIL_BLAST_TEST_SUBJECT_PREFIX = "[TEST] ";

/**
 * The one eligibility block both the admin recipient count and the snapshot use. Binds
 * `email` (lower-cased) and `recipient` (one User per email).
 */
export const ELIGIBLE_RECIPIENTS_CYPHER = `
    MATCH (candidate:User)
    WHERE candidate.marketingConsent = true
      AND candidate.isActive = true
      AND coalesce(candidate.isDeleted, false) = false
      AND candidate.deletionScheduledAt IS NULL
      AND candidate.email IS NOT NULL AND trim(candidate.email) <> ""
      AND NOT EXISTS { MATCH (optOut:EmailOptOut) WHERE toLower(optOut.email) = toLower(candidate.email) }
    WITH toLower(candidate.email) AS email, collect(candidate)[0] AS recipient
`;
