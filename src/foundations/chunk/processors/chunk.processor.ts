import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { TracingService } from "../../../core/tracing/services/tracing.service";
import { ChunkService } from "../../chunk/services/chunk.service";

@Processor(QueueId.CHUNK, { concurrency: 50, lockDuration: 1000 * 60 })
export class ChunkProcessor extends WorkerHost {
  private readonly chunkJobName: string;

  constructor(
    private readonly logger: AppLoggingService,
    private readonly tracer: TracingService,
    private readonly clsService: ClsService,
    private readonly chunkService: ChunkService,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super();
    this.chunkJobName = configService.get("jobNames", { infer: true })?.process?.chunk ?? "process_chunk";
  }

  @OnWorkerEvent("active")
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job`);
  }

  @OnWorkerEvent("failed")
  onError(job: Job) {
    this.logger.error(`Error processing ${job.name} job (ID: ${job.id}). Reason: ${job.failedReason}`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Completed ${job.name} job (ID: ${job.id})`);
  }

  async process(job: Job): Promise<void> {
    if (job.name !== this.chunkJobName) {
      throw new Error(`Job ${job.name} not handled by ChunkProcessor`);
    }

    await this.clsService.run(async () => {
      this.clsService.set("companyId", job.data.companyId);
      this.clsService.set("userId", job.data.userId);

      await this.chunkService.generateGraph({
        companyId: job.data.companyId,
        userId: job.data.userId,
        chunkId: job.data.chunkId,
        id: job.data.contentId,
        type: job.data.contentType,
      });
    });
  }
}
