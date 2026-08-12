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
    // Single-winner latch: ChunkService enqueues one finalise job per chunk, so a pending-chunk
    // count only rejects jobs that run WHILE chunking is in flight — under a backlog the rest
    // all re-run the pipeline. The claim subsumes the pending-chunk check.
    // Mark completed when all chunks are done.
    const claimed = await this.chunkRepository.claimContentFinalisation({
      id: params.howToId,
      nodeType: howToMeta.labelName,
    });

    if (!claimed) return;

    try {
      await this.howToService.updateAiStatus({
        id: params.howToId,
        aiStatus: AiStatus.InProgress,
      });

      await this.howToService.updateAiStatus({
        id: params.howToId,
        aiStatus: AiStatus.Completed,
      });
    } catch (error) {
      // Release the latch taken above, or a BullMQ retry would find it held and no-op.
      await this.chunkRepository.clearFinalisationClaim({
        id: params.howToId,
        nodeType: howToMeta.labelName,
      });
      throw error;
    }
  }
}
