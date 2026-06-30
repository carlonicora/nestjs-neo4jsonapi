import { InjectQueue } from "@nestjs/bullmq";
import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { chunkMeta } from "../../chunk/entities/chunk.meta";
import { ChunkService } from "../../chunk/services/chunk.service";

// App embedding-rebuild queues. The package QueueId enum is a base apps extend;
// apps register these queues via config.chunkQueues.queueIds (or the module below
// registers them locally). Job names come from config.jobNames.process.
const EMBEDDING_CHUNKS_QUEUE = "embedding-chunks";
const EMBEDDING_KEYCONCEPTS_QUEUE = "embedding-keyconcepts";

@Controller()
export class ChunkController {
  private readonly rebuildChunksJobName: string;
  private readonly rebuildKeyConceptsJobName: string;

  constructor(
    private readonly chunkService: ChunkService,
    private readonly clsService: ClsService,
    @InjectQueue(EMBEDDING_CHUNKS_QUEUE) private readonly embeddingQueue: Queue,
    @InjectQueue(EMBEDDING_KEYCONCEPTS_QUEUE) private readonly keyConceptQueue: Queue,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    const jobNames = configService.get("jobNames", { infer: true });
    this.rebuildChunksJobName = jobNames?.process?.rebuild_chunks ?? "embedding:rebuild_chunks";
    this.rebuildKeyConceptsJobName = jobNames?.process?.rebuild_keyconcepts ?? "embedding:rebuild_keyconcepts";
  }

  @UseGuards(JwtAuthGuard)
  @Get(`${chunkMeta.endpoint}/:chunkId`)
  async findById(@Param("chunkId") chunkId: string) {
    return await this.chunkService.findById({ chunkId: chunkId });
  }

  @UseGuards(JwtAuthGuard)
  @Post(`${chunkMeta.endpoint}/rebuild-embeddings`)
  async rebuildEmbeddings(): Promise<{ jobId: string; message: string }> {
    const companyId = this.clsService.get("companyId");
    const userId = this.clsService.get("userId");

    const job = await this.embeddingQueue.add(
      this.rebuildChunksJobName,
      { companyId, userId },
      { removeOnComplete: true, removeOnFail: false },
    );

    return {
      jobId: job.id,
      message: "Chunk embedding rebuild job queued successfully",
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post(`${chunkMeta.endpoint}/rebuild-all-embeddings`)
  async rebuildAllEmbeddings(): Promise<{
    chunkJobId: string;
    keyConceptJobId: string;
    message: string;
  }> {
    const companyId = this.clsService.get("companyId");
    const userId = this.clsService.get("userId");

    const [chunkJob, keyConceptJob] = await Promise.all([
      this.embeddingQueue.add(
        this.rebuildChunksJobName,
        { companyId, userId },
        { removeOnComplete: true, removeOnFail: false },
      ),
      this.keyConceptQueue.add(
        this.rebuildKeyConceptsJobName,
        { companyId, userId },
        { removeOnComplete: true, removeOnFail: false },
      ),
    ]);

    return {
      chunkJobId: chunkJob.id,
      keyConceptJobId: keyConceptJob.id,
      message: "All embedding rebuild jobs queued successfully",
    };
  }
}
