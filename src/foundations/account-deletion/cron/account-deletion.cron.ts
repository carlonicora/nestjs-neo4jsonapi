import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import {
  ACCOUNT_DELETION_JOB_NAMES,
  ACCOUNT_DELETION_JOB_OPTIONS,
  AccountDeletionJobData,
  accountDeletionJobId,
} from "../account-deletion.constants";
import { AccountDeletionRepository } from "../repositories/account-deletion.repository";

/**
 * Daily: one `delete-account` job per user whose grace period is over. Runs in
 * the worker only (ScheduleModule is mounted only when cron jobs are enabled).
 * The job id is fixed per user, so a user is never queued twice; a job that
 * failed every attempt is removed and queued again, so a wipe never stays
 * half done.
 */
@Injectable()
export class AccountDeletionCron {
  constructor(
    @InjectQueue(QueueId.ACCOUNT_DELETION) private readonly queue: Queue,
    private readonly accountDeletionRepository: AccountDeletionRepository,
    private readonly clsService: ClsService,
    private readonly logger: AppLoggingService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async enqueueDue(): Promise<void> {
    await this.clsService.run(async () => {
      const due = await this.accountDeletionRepository.findDue({ now: new Date().toISOString() });

      for (const user of due) {
        const jobId = accountDeletionJobId(user.id);
        try {
          const existing = await this.queue.getJob(jobId);
          if (existing && (await existing.isFailed())) await existing.remove();

          const data: AccountDeletionJobData = { userId: user.id };
          await this.queue.add(ACCOUNT_DELETION_JOB_NAMES.deleteAccount, data, {
            ...ACCOUNT_DELETION_JOB_OPTIONS,
            jobId,
          });
        } catch (error) {
          this.logger.error(
            `Failed to queue account deletion ${user.id}: ${(error as Error).message}`,
            "AccountDeletionCron",
          );
        }
      }

      if (due.length > 0) this.logger.log(`Queued ${due.length} account deletion(s)`, "AccountDeletionCron");
    });
  }
}
