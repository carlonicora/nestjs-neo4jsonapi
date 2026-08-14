import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { AiStatus, EntityAiStatus } from "../../../common/enums/ai.status";
import { modelRegistry } from "../../../common/registries/registry";
import { CHUNK_QUEUE_CONCURRENCY } from "../../../config/base.config";
import { QueueId } from "../../../config/enums/queue.id";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { TracingService } from "../../../core/tracing/services/tracing.service";
import { CompanyService } from "../../company/services/company.service";
import { ChunkService } from "../../chunk/services/chunk.service";
import { ChunkRepository } from "../repositories/chunk.repository";

// Concurrency comes from `CHUNK_QUEUE_CONCURRENCY` (default 50 — unchanged from
// the literal that used to sit here). `@Processor` options are evaluated at
// DECORATION time, so this cannot be injected: it must be a module-level
// constant, and that constant resolves the env var inside `base.config.ts`,
// the one file allowed to read `process.env`.
@Processor(QueueId.CHUNK, { concurrency: CHUNK_QUEUE_CONCURRENCY, lockDuration: 1000 * 60 })
export class ChunkProcessor extends WorkerHost {
  private readonly chunkJobName: string;

  constructor(
    private readonly logger: AppLoggingService,
    private readonly tracer: TracingService,
    private readonly clsService: ClsService,
    private readonly chunkService: ChunkService,
    private readonly companyService: CompanyService,
    private readonly chunkRepository: ChunkRepository,
    private readonly neo4j: Neo4jService,
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

      // Pre-flight credit gate (spec §2): defer, don't fail — the chunk stays
      // marked and approval re-processes it via its owning entity. Not a job failure.
      if (!(await this.companyService.hasAvailableCredits({ companyId: job.data.companyId }))) {
        await this.chunkRepository.updateStatus({ id: job.data.chunkId, aiStatus: AiStatus.PendingCredits });
        // Roll the deferral up under the owning entity (spec §3.2) so the backlog
        // lists it even when the debounce gate passed but credits ran out mid-fan-out.
        await this.markOwnerPendingCredits(job.data.contentType, job.data.contentId);
        return;
      }

      await this.chunkService.generateGraph({
        companyId: job.data.companyId,
        userId: job.data.userId,
        chunkId: job.data.chunkId,
        id: job.data.contentId,
        type: job.data.contentType,
      });
    });
  }

  /**
   * Rolls a chunk-level credit deferral up to the owning entity (spec §3.2) so
   * the backlog reflects it even when the debounce gate passed upstream but
   * credits ran out mid-fan-out across a document's chunks. `contentType` is
   * the Neo4j label (per the `HowToService._chunkAndQueue` enqueue convention:
   * `contentType: howToMeta.labelName`), resolved via `modelRegistry` the same
   * way `buildEmbedderAttribution` does. Document flows without a registered
   * entity model keep the chunk-level marker only (already set by the caller).
   */
  private async markOwnerPendingCredits(contentType: string, contentId: string): Promise<void> {
    const model = modelRegistry.getByLabelName(contentType);
    if (!model) {
      this.logger.warn(
        `markOwnerPendingCredits: no model registered for label "${contentType}" — skipping entity-level marker for ${contentId}`,
      );
      return;
    }

    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, id: contentId, aiStatus: EntityAiStatus.PendingCredits };
    query.query += `
      MATCH (entity:${model.labelName} { id: $id })-[:BELONGS_TO]->(company)
      SET entity.aiStatus = $aiStatus, entity.creditsDeferredAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }
}
