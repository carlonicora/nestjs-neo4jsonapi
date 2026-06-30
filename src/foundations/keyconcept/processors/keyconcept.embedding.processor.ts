import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { EmbedderService } from "../../../core";
import { KeyConceptRepository } from "../repositories/keyconcept.repository";

export const KEYCONCEPT_EMBEDDING_QUEUE = "embedding-keyconcepts";

@Processor(KEYCONCEPT_EMBEDDING_QUEUE, { concurrency: 1, lockDuration: 1000 * 60 * 30 })
export class KeyConceptEmbeddingProcessor extends WorkerHost {
  private readonly rebuildKeyConceptsJobName: string;

  constructor(
    private readonly clsService: ClsService,
    private readonly keyConceptRepository: KeyConceptRepository,
    private readonly embedderService: EmbedderService,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super();
    this.rebuildKeyConceptsJobName =
      configService.get("jobNames", { infer: true })?.process?.rebuild_keyconcepts ?? "embedding:rebuild_keyconcepts";
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
    if (job.name !== this.rebuildKeyConceptsJobName) {
      throw new Error(`Job ${job.name} not handled by KeyConceptEmbeddingProcessor`);
    }

    return await this.clsService.run(async () => {
      this.clsService.set("companyId", job.data.companyId);
      this.clsService.set("userId", job.data.userId);
      this.clsService.set("isAutomatedJob", true);

      // 1. Recreate vector index with new dimensions
      await this.keyConceptRepository.recreateVectorIndex();

      // 2. Get all keyconcepts
      const allKeyConcepts = await this.keyConceptRepository.findAllKeyConcepts();
      const keyConceptsWithValues = allKeyConcepts.filter((k) => k.value);

      // 3. Process in batches
      const batchSize = 100;
      let processed = 0;

      for (let i = 0; i < keyConceptsWithValues.length; i += batchSize) {
        const batch = keyConceptsWithValues.slice(i, i + batchSize);

        const texts = batch.map((k) => k.value);
        const embeddings = await this.embedderService.vectoriseTextBatch(texts);

        for (let j = 0; j < batch.length; j++) {
          await this.keyConceptRepository.updateEmbedding({
            keyConceptId: batch[j].id,
            embedding: embeddings[j],
          });
          processed++;
        }

        const progress = Math.round((processed / keyConceptsWithValues.length) * 100);
        await job.updateProgress(progress);
      }

      return { processed };
    });
  }
}
