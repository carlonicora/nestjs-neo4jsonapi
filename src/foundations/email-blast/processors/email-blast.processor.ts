import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { EMAIL_BLAST_JOB_NAMES, EmailBlastJobData } from "../email-blast.constants";
import { EmailBlastDeliveryService } from "../services/email-blast-delivery.service";

/**
 * Worker for `QueueId.EMAIL_BLAST` (registered with `createWorkerProvider`).
 * One job at a time with a long lock: a blast to every consenting user can run for minutes.
 * Each job runs in its own CLS context with no company set: the recipients span every
 * company (owner decision D-1/D-3).
 */
@Processor(QueueId.EMAIL_BLAST, { concurrency: 1, lockDuration: 15 * 60 * 1000 })
export class EmailBlastProcessor extends WorkerHost {
  constructor(
    private readonly deliveryService: EmailBlastDeliveryService,
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

  async process(job: Job<EmailBlastJobData>): Promise<void> {
    switch (job.name) {
      case EMAIL_BLAST_JOB_NAMES.sendBlast: {
        const { blastId } = job.data;
        const { sent, skipped, failed } = await this.clsService.run(() =>
          this.deliveryService.processBlast({ blastId }),
        );
        this.logger.log(
          `Email blast ${blastId}: ${sent} sent, ${skipped} skipped, ${failed} failed`,
          "EmailBlastProcessor",
        );
        return;
      }
      default:
        this.logger.warn(`Unknown email-blast job ${job.name} (ID: ${job.id})`);
    }
  }
}
