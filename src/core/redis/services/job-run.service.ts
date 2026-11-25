import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { RedisLockService } from "./redis.lock.service";

/** The fields of a BullMQ job that identify one job instance and one attempt of it. */
export type JobRef = { queueName: string; id?: string; timestamp: number; attemptsMade?: number };

const COMPLETED_TTL_SECONDS = 86400;
const DEFAULT_CLAIM_TTL_SECONDS = 86400;

/**
 * Repeat detection for queue jobs that can be delivered more than once.
 *
 * - A finished marker per job instance, so a redelivery of a job that already
 *   finished ends at once.
 * - One-shot claims for effects that cannot be undone (a DM, a sound).
 * - A stable usage id per job attempt, so a second run of the same attempt is not charged twice.
 *
 * Redis errors never fail the job: a failed read counts as "not done", a failed claim as "claimed"
 * (or as "not claimed" when the caller asks for `failClosed`).
 */
@Injectable()
export class JobRunService {
  private readonly logger = new Logger(JobRunService.name);

  /**
   * The owner token of every claim this instance took and has not given back, so
   * {@link unclaim} deletes a claim only while it is still ours. Entries past their
   * TTL are dropped on the next claim, so kept claims do not pile up.
   */
  private readonly claimTokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly redisLock: RedisLockService) {}

  /** `<queueName>-<id>-<timestamp>`: no colon, so it is also safe inside a BullMQ job id. */
  key(job: JobRef): string {
    return `${job.queueName}-${job.id}-${job.timestamp}`;
  }

  async isCompleted(job: JobRef): Promise<boolean> {
    try {
      return await this.redisLock.isHeld(this.completedKey(job));
    } catch (error) {
      this.logger.warn(`Could not read the finished marker of ${this.key(job)}: ${(error as Error).message}`);
      return false;
    }
  }

  /** Writes the finished marker for 24 hours. Never throws. */
  async markCompleted(job: JobRef): Promise<void> {
    try {
      await this.redisLock.tryAcquire(this.completedKey(job), COMPLETED_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Could not write the finished marker of ${this.key(job)}: ${(error as Error).message}`);
    }
  }

  /**
   * True the first time a name is claimed within the TTL.
   *
   * On a Redis error the claim is true by default (a repeat is better than a
   * lost effect). With `failClosed` it is false instead, for an effect where a
   * repeat is worse than a skip (a sound played twice): the caller treats an
   * unconfirmed claim like a claim already taken.
   */
  async claim(
    name: string,
    ttlSeconds: number = DEFAULT_CLAIM_TTL_SECONDS,
    options?: { failClosed?: boolean },
  ): Promise<boolean> {
    this.pruneExpiredClaimTokens();
    try {
      const token = await this.redisLock.tryAcquireOwned(this.claimKey(name), ttlSeconds);
      if (token === null) return false;
      this.claimTokens.set(name, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
      return true;
    } catch (error) {
      const failClosed = options?.failClosed === true;
      this.logger.warn(
        `Could not claim ${name}: ${(error as Error).message}; ${failClosed ? "not claimed (fail closed)" : "counted as claimed"}`,
      );
      return !failClosed;
    }
  }

  /**
   * Gives a claim back. Never throws.
   *
   * Only a claim this instance took, and only while Redis still holds it under
   * this instance's token: a claim that expired and was taken by another owner
   * stays in place. A claim this instance never confirmed (a Redis error counted
   * as claimed) has nothing of ours to delete.
   */
  async unclaim(name: string): Promise<void> {
    const owned = this.claimTokens.get(name);
    this.claimTokens.delete(name);
    if (!owned) {
      this.logger.debug(`Claim ${name} is not held by this instance; nothing to release`);
      return;
    }
    try {
      await this.redisLock.release(this.claimKey(name), owned.token);
    } catch (error) {
      this.logger.warn(`Could not release claim ${name}: ${(error as Error).message}`);
    }
  }

  /** A UUID-shaped (version 5 layout) id, the same for every delivery of the same job attempt and scope. */
  usageId(job: JobRef, scope: string): string {
    const bytes = createHash("sha1")
      .update(`${scope}:${this.key(job)}:${job.attemptsMade ?? 0}`)
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  private pruneExpiredClaimTokens(): void {
    const now = Date.now();
    for (const [name, owned] of this.claimTokens) {
      if (owned.expiresAt <= now) this.claimTokens.delete(name);
    }
  }

  private completedKey(job: JobRef): string {
    return this.redisLock.scopedKey(`job-done:${this.key(job)}`);
  }

  private claimKey(name: string): string {
    return this.redisLock.scopedKey(`once:${name}`);
  }
}
