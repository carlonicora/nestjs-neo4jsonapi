import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { QueueId } from "../../../config/enums/queue.id";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { ChunkRepository } from "../../chunk/repositories/chunk.repository";
import { handbookPageMeta } from "../entities/handbook-page.meta";
import { HandbookPageService } from "../services/handbook-page.service";

@Processor(QueueId.HANDBOOK_PAGE, { concurrency: 10, lockDuration: 1000 * 60 })
export class HandbookProcessor extends WorkerHost {
  private readonly handbookJobName: string;

  constructor(
    private readonly logger: AppLoggingService,
    private readonly handbookPageService: HandbookPageService,
    private readonly chunkRepository: ChunkRepository,
    private readonly cls: ClsService,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super();
    this.handbookJobName =
      configService.get("jobNames", { infer: true })?.process?.HandbookPage ?? "process_handbookpage";
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
    if (job.name !== this.handbookJobName) {
      throw new Error(`Job ${job.name} not handled by HandbookProcessor`);
    }

    await this.cls.run(async () => {
      this.cls.set("userId", job.data.userId);
      this.cls.set("isAutomatedJob", true);

      if (job.data.companyId) {
        this.cls.set("companyId", job.data.companyId);
      }

      await this._finalise({ handbookPageId: job.data.id });
    });
  }

  private async _finalise(params: { handbookPageId: string }): Promise<void> {
    // Single-winner latch: ChunkService enqueues one finalise job per chunk, so a
    // pending-chunk count only rejects jobs that run WHILE chunking is in flight.
    // The claim subsumes that check.
    const claimed = await this.chunkRepository.claimContentFinalisation({
      id: params.handbookPageId,
      nodeType: handbookPageMeta.labelName,
    });

    if (!claimed) return;

    try {
      await this.handbookPageService.updateAiStatus({
        id: params.handbookPageId,
        aiStatus: AiStatus.Completed,
      });
    } catch (error) {
      // Release the latch, or a BullMQ retry finds it held and no-ops.
      await this.chunkRepository.clearFinalisationClaim({
        id: params.handbookPageId,
        nodeType: handbookPageMeta.labelName,
      });
      throw error;
    }
  }
}
