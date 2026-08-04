import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject } from "@nestjs/common";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { USER_ACTIVITY_CONFIG, UserActivityModuleConfig } from "../interfaces/user-activity.config.interface";
import { UserActivityRecordInput } from "../interfaces/user-activity.record.input";
import { UserActivityRepository } from "../repositories/user-activity.repository";

/**
 * Worker-side of `UserActivityService.record()`.
 *
 * The queue name must be a compile-time constant because `@Processor()` is
 * evaluated at class-decoration time — the same constraint every other package
 * processor lives with (CompanyProcessor, HowToProcessor, ChunkProcessor). The
 * job name, by contrast, is read from `USER_ACTIVITY_CONFIG` at construction
 * time, so producer and consumer always agree on it.
 */
@Processor(QueueId.USER_ACTIVITY, { concurrency: 4 })
export class UserActivityProcessor extends WorkerHost {
  private readonly jobName: string;

  constructor(
    private readonly logger: AppLoggingService,
    private readonly repository: UserActivityRepository,
    private readonly cls: ClsService,
    @Inject(USER_ACTIVITY_CONFIG) config: Required<UserActivityModuleConfig>,
  ) {
    super();
    this.jobName = config.jobName;
  }

  @OnWorkerEvent("failed")
  onError(job: Job) {
    this.logger.error(`UserActivity record failed (jobId=${job.id}): ${job.failedReason ?? "unknown"}`);
  }

  async process(job: Job): Promise<void> {
    if (job.name !== this.jobName) {
      throw new Error(`Job ${job.name} not handled by UserActivityProcessor`);
    }

    const input = job.data as UserActivityRecordInput;

    // The worker runs outside any HTTP request, so CLS is empty: seed it
    // explicitly (isAutomatedJob + userId + companyId) or SecurityService
    // .userHasAccess() has no context to work from.
    await this.cls.run(async () => {
      this.cls.set("isAutomatedJob", true);
      this.cls.set("userId", input.userId);
      this.cls.set("companyId", input.companyId);
      await this.repository.createActivity(input);
    });
  }
}
