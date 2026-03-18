import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigJobNamesInterface } from "../../../config/interfaces/config.job.names.interface";
import { QueueId } from "../../../config/enums/queue.id";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
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
  ) {
    super(jsonApiService, howToRepository, clsService, HowToDescriptor.model);
    this.jobNames = configService.get("jobNames", { infer: true }) ?? { process: {}, notifications: {} };
  }

  /**
   * Queue a HowTo for AI processing.
   * Converts BlockNote JSON to Markdown, chunks it, and queues each chunk.
   */
  async queueHowToForProcessing(params: { howToId: string; description: string }): Promise<void> {
    await this.updateAiStatus({
      id: params.howToId,
      aiStatus: AiStatus.InProgress,
    });

    await this.chunkService.deleteChunks({
      id: params.howToId,
      nodeType: howToMeta.labelName,
    });

    const data = await this.chunkerService.generateContentStructureFromMarkdown({
      content: this.blockNoteService.convertToMarkdown({ nodes: JSON.parse(params.description) }),
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
