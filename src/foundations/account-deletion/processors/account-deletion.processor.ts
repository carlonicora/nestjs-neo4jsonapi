import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { EmailService } from "../../../core/email/services/email.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import {
  ACCOUNT_DELETION_JOB_NAMES,
  AccountDeletedEmailJobData,
  AccountDeletionJobData,
  CompanyWipeJobData,
} from "../account-deletion.constants";
import { AccountWipeService } from "../services/account-wipe.service";
import { FullCompanyDeletionService } from "../services/full-company-deletion.service";

type AccountDeletionQueueJob = Job<AccountDeletionJobData | CompanyWipeJobData | AccountDeletedEmailJobData>;

/**
 * Worker for `QueueId.ACCOUNT_DELETION` (registered with `createWorkerProvider`).
 * One job at a time with a long lock: a company wipe can run for minutes.
 * Each job runs in its own CLS context (set by hand, there is no request).
 */
@Processor(QueueId.ACCOUNT_DELETION, { concurrency: 1, lockDuration: 15 * 60 * 1000 })
export class AccountDeletionProcessor extends WorkerHost {
  constructor(
    private readonly accountWipeService: AccountWipeService,
    private readonly fullCompanyDeletionService: FullCompanyDeletionService,
    private readonly emailService: EmailService,
    private readonly clsService: ClsService,
    private readonly logger: AppLoggingService,
  ) {
    super();
  }

  @OnWorkerEvent("active")
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job (ID: ${job.id})`);
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job) {
    this.logger.error(`Failed ${job.name} job (ID: ${job.id}). Reason: ${job.failedReason}`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Completed ${job.name} job (ID: ${job.id})`);
  }

  async process(job: AccountDeletionQueueJob): Promise<void> {
    switch (job.name) {
      case ACCOUNT_DELETION_JOB_NAMES.deleteAccount: {
        const { userId } = job.data as AccountDeletionJobData;
        await this.clsService.run(() => this.accountWipeService.deleteAccount({ userId }));
        return;
      }
      case ACCOUNT_DELETION_JOB_NAMES.deleteCompany: {
        const { companyId } = job.data as CompanyWipeJobData;
        await this.clsService.run(async () => {
          this.clsService.set("companyId", companyId);
          await this.fullCompanyDeletionService.wipeCompany({ companyId });
        });
        return;
      }
      case ACCOUNT_DELETION_JOB_NAMES.accountDeletedEmail: {
        const { to, name, locale } = job.data as AccountDeletedEmailJobData;
        await this.emailService.sendEmail("accountDeleted", { to, name }, locale);
        return;
      }
      default:
        this.logger.warn(`Unknown account-deletion job ${job.name} (ID: ${job.id})`);
    }
  }
}
