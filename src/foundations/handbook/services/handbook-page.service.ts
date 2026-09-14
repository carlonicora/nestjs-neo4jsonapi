import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { QueueId } from "../../../config/enums/queue.id";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigJobNamesInterface } from "../../../config/interfaces/config.job.names.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { Chunk } from "../../chunk/entities/chunk.entity";
import { ChunkService } from "../../chunk/services/chunk.service";
import { ChunkerService } from "../../chunker/services/chunker.service";
import { HandbookPage, HandbookPageDescriptor } from "../entities/handbook-page";
import { handbookPageMeta } from "../entities/handbook-page.meta";
import { HandbookPageRepository } from "../repositories/handbook-page.repository";

@Injectable()
export class HandbookPageService extends AbstractService<HandbookPage, typeof HandbookPageDescriptor.relationships> {
  protected readonly descriptor = HandbookPageDescriptor;
  private readonly jobNames: ConfigJobNamesInterface;

  constructor(
    jsonApiService: JsonApiService,
    private readonly handbookPageRepository: HandbookPageRepository,
    clsService: ClsService,
    private readonly chunkService: ChunkService,
    private readonly chunkerService: ChunkerService,
    @InjectQueue(QueueId.CHUNK) private readonly chunkQueue: Queue,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super(jsonApiService, handbookPageRepository, clsService, HandbookPageDescriptor.model);
    this.jobNames = configService.get("jobNames", { infer: true }) ?? { process: {}, notifications: {} };
  }

  /**
   * Delete a page and the chunks hanging off it.
   *
   * Overridden for two reasons, both of which break the inherited version:
   *
   * 1. `AbstractService.delete` gates on `(companyId ?? "") !== entity.company?.id`
   *    (abstract.service.ts:272). HandbookPage is `isCompanyScoped: false`, so
   *    `entity.company` is always undefined, and an administrator has no
   *    company either — `"" !== undefined` is true and EVERY delete 403s. Same
   *    reason `HowToService` (app fork) and `CompanyService` override it.
   * 2. The repository's `DETACH DELETE` drops the HAS_CHUNK edges but leaves
   *    the Chunk nodes behind. `ChunkService.deleteChunks` is what also resizes
   *    key-concept relationship weights and clears disconnected atomic facts,
   *    so it has to run first or the graph keeps orphans that still answer
   *    retrieval.
   *
   * The ingest's own deletion pass calls THIS method rather than the
   * repository, so both routes into deleting a page behave identically.
   */
  async delete(params: { id: string }): Promise<void> {
    const page = await this.handbookPageRepository.findById({ id: params.id });
    if (!page) throw new NotFoundException();

    await this.chunkService.deleteChunks({
      id: params.id,
      nodeType: handbookPageMeta.labelName,
    });

    await this.handbookPageRepository.deletePage({ id: params.id });
  }

  async updateAiStatus(params: { id: string; aiStatus: AiStatus }): Promise<void> {
    await this.handbookPageRepository.updateStatus({ id: params.id, aiStatus: params.aiStatus });
  }

  /**
   * Mark in-progress, drop prior chunks, chunk the markdown, enqueue one job per
   * chunk. Identical to HowToService._chunkAndQueue except the markdown arrives
   * from a file rather than from a BlockNote document.
   */
  async chunkAndQueue(params: { handbookPageId: string; markdown: string; title: string }): Promise<void> {
    await this.updateAiStatus({ id: params.handbookPageId, aiStatus: AiStatus.InProgress });

    await this.chunkService.deleteChunks({
      id: params.handbookPageId,
      nodeType: handbookPageMeta.labelName,
    });

    const data = await this.chunkerService.generateContentStructureFromMarkdown({
      content: params.markdown,
      title: params.title,
    });

    const chunks: Chunk[] = await this.chunkService.createChunks({
      id: params.handbookPageId,
      nodeType: handbookPageMeta.labelName,
      data: data,
    });

    const chunkJobName = this.jobNames.process?.chunk ?? "process_chunk";

    for (const chunk of chunks) {
      await this.chunkQueue.add(chunkJobName, {
        companyId: this.clsService.get("companyId") || undefined,
        userId: this.clsService.get("userId"),
        chunkId: chunk.id,
        contentId: params.handbookPageId,
        contentType: handbookPageMeta.labelName,
      });
    }
  }
}
