import { InjectQueue } from "@nestjs/bullmq";
import { Controller, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { keyConceptMeta } from "../entities/key.concept.meta";
import { KEYCONCEPT_EMBEDDING_QUEUE } from "../processors/keyconcept.embedding.processor";

@Controller(keyConceptMeta.endpoint)
export class KeyConceptController {
  private readonly rebuildKeyConceptsJobName: string;

  constructor(
    private readonly clsService: ClsService,
    @InjectQueue(KEYCONCEPT_EMBEDDING_QUEUE) private readonly embeddingQueue: Queue,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    this.rebuildKeyConceptsJobName =
      configService.get("jobNames", { infer: true })?.process?.rebuild_keyconcepts ?? "embedding:rebuild_keyconcepts";
  }

  @UseGuards(JwtAuthGuard)
  @Post("rebuild-embeddings")
  async rebuildEmbeddings(): Promise<{ jobId: string; message: string }> {
    const companyId = this.clsService.get("companyId");
    const userId = this.clsService.get("userId");

    const job = await this.embeddingQueue.add(
      this.rebuildKeyConceptsJobName,
      { companyId, userId },
      { removeOnComplete: true, removeOnFail: false },
    );

    return {
      jobId: job.id,
      message: "KeyConcept embedding rebuild job queued successfully",
    };
  }
}
