import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { TrialJobData } from "../interfaces/trial-job.interface";
import { TrialService } from "../services/trial.service";

@Processor(QueueId.TRIAL, { concurrency: 5, lockDuration: 1000 * 60 })
export class TrialProcessor extends WorkerHost {
  constructor(
    private readonly logger: AppLoggingService,
    private readonly trialService: TrialService,
    private readonly cls: ClsService,
  ) {
    super();
  }

  @OnWorkerEvent("active")
  onActive(job: Job<TrialJobData>) {
    this.logger.debug(`Processing trial job for company ${job.data.companyId} (ID: ${job.id})`);
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job<TrialJobData>, error: Error) {
    this.logger.error(`Trial creation failed for company ${job.data.companyId}: ${error.message}`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<TrialJobData>) {
    this.logger.log(`Trial job completed for company ${job.data.companyId}`);
  }

  async process(job: Job<TrialJobData>): Promise<void> {
    const { companyId, userId } = job.data;

    await this.cls.run(async () => {
      this.cls.set("companyId", companyId);
      this.cls.set("userId", userId);

      await this.trialService.startTrial({ companyId, userId });
    });
  }
}
