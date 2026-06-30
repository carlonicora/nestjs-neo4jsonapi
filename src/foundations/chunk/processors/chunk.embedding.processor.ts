import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { EmbedderService } from "../../../core";
import { ChunkRepository } from "../repositories/chunk.repository";

const EMBEDDING_CHUNKS_QUEUE = "embedding-chunks";

@Processor(EMBEDDING_CHUNKS_QUEUE, { concurrency: 1, lockDuration: 1000 * 60 * 30 })
export class ChunkEmbeddingProcessor extends WorkerHost {
  private readonly rebuildChunksJobName: string;

  constructor(
    private readonly clsService: ClsService,
    private readonly chunkRepository: ChunkRepository,
    private readonly embedderService: EmbedderService,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super();
    this.rebuildChunksJobName =
      configService.get("jobNames", { infer: true })?.process?.rebuild_chunks ?? "embedding:rebuild_chunks";
  }

  @OnWorkerEvent("active")
  onActive(job: Job) {
    console.log(`Processing ${job.name} job`);
  }

  @OnWorkerEvent("failed")
  onError(job: Job) {
    console.error(`Error processing ${job.name} job (ID: ${job.id}). Reason: ${job.failedReason}`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    console.log(`Completed ${job.name} job (ID: ${job.id})`);
  }

  async process(job: Job): Promise<{ processed: number }> {
    if (job.name !== this.rebuildChunksJobName) {
      throw new Error(`Job ${job.name} not handled by ChunkEmbeddingProcessor`);
    }

    return await this.clsService.run(async () => {
      this.clsService.set("companyId", job.data.companyId);
      this.clsService.set("userId", job.data.userId);
      this.clsService.set("isAutomatedJob", true);

      // 1. Recreate vector index with new dimensions
      await this.chunkRepository.recreateVectorIndex();

      // 2. Get all chunks
      const allChunks = await this.chunkRepository.findAllChunks();
      const chunksWithContent = allChunks.filter((c) => c.content);

      // 3. Process in batches
      const batchSize = 100;
      let processed = 0;

      for (let i = 0; i < chunksWithContent.length; i += batchSize) {
        const batch = chunksWithContent.slice(i, i + batchSize);

        const texts = batch.map((c) => c.content);
        const embeddings = await this.embedderService.vectoriseTextBatch(texts);

        for (let j = 0; j < batch.length; j++) {
          await this.chunkRepository.updateEmbedding({
            chunkId: batch[j].id,
            embedding: embeddings[j],
          });
          processed++;
        }

        const progress = Math.round((processed / chunksWithContent.length) * 100);
        await job.updateProgress(progress);
      }

      return { processed };
    });
  }
}
