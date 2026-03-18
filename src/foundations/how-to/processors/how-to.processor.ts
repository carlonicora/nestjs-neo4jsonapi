import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { QueueId } from "../../../config/enums/queue.id";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { ChunkRepository } from "../../chunk/repositories/chunk.repository";
import { howToMeta } from "../entities/how-to.meta";
import { HowToService } from "../services/how-to.service";

@Processor(QueueId.HOWTO, { concurrency: 10, lockDuration: 1000 * 60 })
export class HowToProcessor extends WorkerHost {
  private readonly howToJobName: string;

  constructor(
    private readonly logger: AppLoggingService,
    private readonly howToService: HowToService,
    private readonly chunkRepository: ChunkRepository,
    private readonly cls: ClsService,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super();
    this.howToJobName = configService.get("jobNames", { infer: true })?.process?.HowTo ?? "process_howto";
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
    if (job.name !== this.howToJobName) {
      throw new Error(`Job ${job.name} not handled by HowToProcessor`);
    }

    await this.cls.run(async () => {
      this.cls.set("userId", job.data.userId);
      this.cls.set("isAutomatedJob", true);

      if (job.data.companyId) {
        this.cls.set("companyId", job.data.companyId);
      }

      await this._processHowTo({
        howToId: job.data.id,
      });
    });
  }

  private async _processHowTo(params: { howToId: string }): Promise<void> {
    const pendingChunks = await this.chunkRepository.getChunksInProgress({
      id: params.howToId,
      nodeType: howToMeta.labelName,
    });

    await this.howToService.updateAiStatus({
      id: params.howToId,
      aiStatus: AiStatus.InProgress,
    });

    // Mark completed when all chunks are done
    if (pendingChunks.length === 0) {
      await this.howToService.updateAiStatus({
        id: params.howToId,
        aiStatus: AiStatus.Completed,
      });
    }
  }
}
