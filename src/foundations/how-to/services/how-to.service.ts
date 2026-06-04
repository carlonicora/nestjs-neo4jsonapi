import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigJobNamesInterface } from "../../../config/interfaces/config.job.names.interface";
import { QueueId } from "../../../config/enums/queue.id";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { Chunk } from "../../chunk/entities/chunk.entity";
import { ChunkRepository } from "../../chunk/repositories/chunk.repository";
import { ChunkService } from "../../chunk/services/chunk.service";
import { ChunkerService } from "../../chunker/services/chunker.service";
import { HowTo, HowToDescriptor } from "../entities/how-to";
import { howToMeta } from "../entities/how-to.meta";
import { HowToRepository } from "../repositories/how-to.repository";

@Injectable()
export class HowToService extends AbstractService<HowTo, typeof HowToDescriptor.relationships> {
  protected readonly descriptor = HowToDescriptor;
  private readonly jobNames: ConfigJobNamesInterface;

  constructor(
    jsonApiService: JsonApiService,
    private readonly howToRepository: HowToRepository,
    clsService: ClsService,
    private readonly chunkService: ChunkService,
    private readonly chunkerService: ChunkerService,
    private readonly blockNoteService: BlockNoteService,
    private readonly webSocketService: WebSocketService,
    private readonly chunkRepository: ChunkRepository,
    @InjectQueue(QueueId.CHUNK) private readonly chunkQueue: Queue,
    configService: ConfigService<BaseConfigInterface>,
    private readonly logger: AppLoggingService,
  ) {
    super(jsonApiService, howToRepository, clsService, HowToDescriptor.model);
    this.jobNames = configService.get("jobNames", { infer: true }) ?? { process: {}, notifications: {} };
  }

  /**
   * Queue a HowTo for AI processing.
   * Converts BlockNote JSON to Markdown, then delegates to _chunkAndQueue.
   */
  async queueHowToForProcessing(params: { howToId: string; description: string }): Promise<void> {
    const markdown = this.blockNoteService.convertToMarkdown({ nodes: JSON.parse(params.description) });
    await this._chunkAndQueue({ howToId: params.howToId, markdown });
  }

  /**
   * Private: mark in-progress, delete prior chunks, chunk the markdown, enqueue jobs.
   */
  private async _chunkAndQueue(params: { howToId: string; markdown: string }): Promise<void> {
    await this.updateAiStatus({
      id: params.howToId,
      aiStatus: AiStatus.InProgress,
    });

    await this.chunkService.deleteChunks({
      id: params.howToId,
      nodeType: howToMeta.labelName,
    });

    const data = await this.chunkerService.generateContentStructureFromMarkdown({
      content: params.markdown,
    });

    const chunks: Chunk[] = await this.chunkService.createChunks({
      id: params.howToId,
      nodeType: howToMeta.labelName,
      data: data,
    });

    await this.updateAiStatus({
      id: params.howToId,
      aiStatus: AiStatus.InProgress,
    });

    const chunkJobName = this.jobNames.process?.chunk ?? "process_chunk";

    for (const chunk of chunks) {
      await this.chunkQueue.add(chunkJobName, {
        companyId: this.clsService.get("companyId") || undefined,
        userId: this.clsService.get("userId"),
        chunkId: chunk.id,
        contentId: params.howToId,
        contentType: howToMeta.labelName,
      });
    }
  }

  async findPublishedList(params: { query: any; howToType?: string }): Promise<any> {
    const paginator = new JsonApiPaginator(params.query);
    const data = await this.howToRepository.findPublished({ howToType: params.howToType });
    return this.jsonApiService.buildList(HowToDescriptor.model, data, paginator);
  }

  async findPublishedArticle(params: { howToType: string; slug: string }): Promise<any> {
    const data = await this.howToRepository.findPublishedByTypeAndSlug(params);
    if (!data) {
      throw new NotFoundException(`HowTo ${params.howToType}/${params.slug} not found`);
    }
    return this.jsonApiService.buildSingle(HowToDescriptor.model, data);
  }

  async findRelatedList(params: { howToType: string; slug: string; query: any }): Promise<any> {
    const article = await this.howToRepository.findPublishedByTypeAndSlug({
      howToType: params.howToType,
      slug: params.slug,
    });
    if (!article) {
      throw new NotFoundException(`HowTo ${params.howToType}/${params.slug} not found`);
    }
    const paginator = new JsonApiPaginator(params.query);
    const data = await this.howToRepository.findRelated({ howToId: article.id });
    return this.jsonApiService.buildList(HowToDescriptor.model, data, paginator);
  }

  async addRelated(params: { howToId: string; relatedId: string }): Promise<any> {
    await this.howToRepository.addRelated(params);
    return this.findById({ id: params.howToId });
  }

  async removeRelated(params: { howToId: string; relatedId: string }): Promise<void> {
    await this.howToRepository.removeRelated(params);
  }

  /**
   * Re-chunk every HowTo (seeded nodes get no chunks from a raw-Cypher migration).
   * Per-item failures (e.g. legacy plain-text descriptions that are not BlockNote JSON)
   * are logged and skipped, never silently dropped.
   */
  async reindexAll(): Promise<void> {
    const all = await this.howToRepository.findAllHowTos();
    let queued = 0;
    let failed = 0;
    for (const howTo of all) {
      if (!howTo.description) continue;
      try {
        await this.queueHowToForProcessing({ howToId: howTo.id, description: howTo.description });
        queued++;
      } catch (error: any) {
        failed++;
        this.logger.warn(`reindexAll: skipped HowTo ${howTo.id}: ${error?.message ?? error}`);
      }
    }
    this.logger.log(`HowTo reindex done — total=${all.length} queued=${queued} failed=${failed}`);
  }

  /**
   * Update AI status and broadcast progress via WebSocket.
   */
  async updateAiStatus(params: { id: string; aiStatus: AiStatus }): Promise<void> {
    await this.howToRepository.updateStatus({
      id: params.id,
      aiStatus: params.aiStatus,
    });

    if (params.aiStatus === AiStatus.InProgress) {
      const chunks: Chunk[] = await this.chunkRepository.findChunkByContentIdAndType({
        id: params.id,
        type: howToMeta.labelName,
      });

      await this.webSocketService.sendMessageToUser(this.clsService.get("userId"), "graph_creation", {
        id: params.id,
        aiStatus: params.aiStatus,
        completed: chunks.filter((chunk: Chunk) => chunk.aiStatus === AiStatus.Completed).length,
        total: chunks.length,
      });
    } else {
      await this.webSocketService.sendMessageToUser(this.clsService.get("userId"), "graph_creation", {
        id: params.id,
        aiStatus: params.aiStatus,
        completed: 0,
        total: 0,
      });
    }
  }
}
