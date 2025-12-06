import { Document } from "@langchain/core/documents";
import { getQueueToken } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { Queue } from "bullmq";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { GraphCreatorService } from "../../../agents/graph.creator/services/graph.creator.service";
import { AiStatus } from "../../../common/enums/ai.status";
import { ChunkAnalysisInterface } from "../../../common/interfaces/agents/graph.creator.interface";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigJobNamesInterface } from "../../../config/interfaces/config.job.names.interface";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { TracingService } from "../../../core/tracing/services/tracing.service";
import { AtomicFactService } from "../../atomicfact/services/atomicfact.service";
import { Chunk } from "../../chunk/entities/chunk.entity";
import { ChunkModel } from "../../chunk/entities/chunk.model";
import { ChunkRepository } from "../../chunk/repositories/chunk.repository";
import { KeyConceptRepository } from "../../keyconcept/repositories/keyconcept.repository";
import { KeyConceptService } from "../../keyconcept/services/keyconcept.service";
import { TokenUsageType } from "../../tokenusage/enums/tokenusage.type";
import { TokenUsageService } from "../../tokenusage/services/tokenusage.service";

@Injectable()
export class ChunkService {
  private readonly jobNames: ConfigJobNamesInterface;

  constructor(
    private readonly logger: AppLoggingService,
    private readonly tracer: TracingService,
    private readonly clsService: ClsService,
    private readonly builder: JsonApiService,
    private readonly chunkRepository: ChunkRepository,
    private readonly atomicFactService: AtomicFactService,
    private readonly keyConceptService: KeyConceptService,
    private readonly graphGeneratorService: GraphCreatorService,
    private readonly keyConceptRepository: KeyConceptRepository,
    private readonly tokenUsageService: TokenUsageService,
    private readonly moduleRef: ModuleRef,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    this.jobNames = configService.get("jobNames", { infer: true }) ?? { process: {}, notifications: {} };
  }

  private isDeadlockError(error: any): boolean {
    const errorMessage = error?.message || error?.toString() || "";
    return (
      errorMessage.includes("can't acquire ExclusiveLock") ||
      errorMessage.includes("ForsetiClient") ||
      errorMessage.includes("Transaction failed") ||
      errorMessage.includes("deadlock")
    );
  }

  private createEmptyChunkAnalysis(): ChunkAnalysisInterface {
    return {
      atomicFacts: [],
      keyConceptsRelationships: [],
      tokens: { input: 0, output: 0 },
    };
  }

  private async retryWithExponentialBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000,
    operationName: string = "database operation",
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (this.isDeadlockError(error)) {
          if (attempt < maxRetries) {
            const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
            this.logger.warn(
              `Deadlock detected in ${operationName}, attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${Math.round(delayMs)}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          } else {
            this.logger.error(
              `Deadlock retry exhausted for ${operationName} after ${maxRetries + 1} attempts. Final error: ${error.message}`,
            );
          }
        } else {
          this.logger.error(`Non-deadlock error in ${operationName}: ${error.message}`);
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async retryGraphGenerationWithFallback(
    operation: () => Promise<ChunkAnalysisInterface>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000,
    chunkId: string,
  ): Promise<ChunkAnalysisInterface> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 0) {
          this.logger.log(`Graph generation succeeded on attempt ${attempt + 1} for chunk ${chunkId}`);
        }
        return result;
      } catch (error) {
        if (attempt < maxRetries) {
          const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
          this.logger.warn(
            `Graph generation failed for chunk ${chunkId}, attempt ${attempt + 1}/${maxRetries + 1}. Error: ${error.message}. Retrying in ${Math.round(delayMs)}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        } else {
          this.logger.error(
            `Graph generation failed permanently for chunk ${chunkId} after ${maxRetries + 1} attempts. Final error: ${error.message}. Using empty fallback analysis.`,
          );
        }
      }
    }

    // Return empty analysis as fallback to allow processing to continue
    this.logger.warn(`Chunk ${chunkId} will be processed with empty analysis due to graph generation failure`);
    return this.createEmptyChunkAnalysis();
  }

  async findById(params: { chunkId: string }): Promise<JsonApiDataInterface> {
    const chunk = await this.chunkRepository.findChunkById({
      chunkId: params.chunkId,
    });

    return this.builder.buildSingle(ChunkModel, chunk);
  }

  async createChunks(params: { id: string; nodeType: string; data: Document[] }): Promise<Chunk[]> {
    let previousChunkId = undefined;
    let position = 0;

    for (const document of params.data) {
      const chunkId = randomUUID();
      await this.chunkRepository.createChunk({
        id: chunkId,
        nodeId: params.id,
        nodeType: params.nodeType,
        previousChunkId: previousChunkId,
        content: document.pageContent,
        position: position,
      });

      previousChunkId = chunkId;
      position++;
    }

    return this.chunkRepository.findChunks({
      id: params.id,
      nodeType: params.nodeType,
    });
  }

  async deleteChunks(params: { id: string; nodeType: string }): Promise<void> {
    const chunks = await this.chunkRepository.findChunks({
      id: params.id,
      nodeType: params.nodeType,
    });

    for (const chunk of chunks) {
      await this.keyConceptService.resizeKeyConceptRelationshipsWeightOnChunkDeletion({ chunkId: chunk.id });
    }

    await this.chunkRepository.deleteChunksByNodeType({
      id: params.id,
      nodeType: params.nodeType,
    });

    await this.atomicFactService.deleteDisconnectedAtomicFacts();
  }

  async generateGraph(params: {
    companyId: string;
    userId: string;
    chunkId: string;
    id: string;
    type: string;
  }): Promise<void> {
    this.tracer.startSpan("Graph Creation", {
      attributes: {
        chunkId: params.chunkId,
        companyId: params.companyId,
        userId: params.userId,
      },
    });

    const chunk = await this.chunkRepository.findChunkById({
      chunkId: params.chunkId,
    });

    this.tracer.addSpanEvent("Read Chunk");

    await this.chunkRepository.updateStatus({
      id: params.chunkId,
      aiStatus: AiStatus.InProgress,
    });

    this.tracer.addSpanEvent("Update Chunk Status");

    const chunkAnalysis: ChunkAnalysisInterface = await this.retryGraphGenerationWithFallback(
      () =>
        this.graphGeneratorService.generateGraph({
          content: chunk.content,
        }),
      3,
      1000,
      params.chunkId,
    );

    this.tracer.addSpanEvent("Generate Graph");

    if (chunkAnalysis) {
      this.logger.debug("Chunk analysis successful, processing results", "ChunkService", {
        chunkId: params.chunkId,
        atomicFactsCount: chunkAnalysis.atomicFacts.length,
        relationshipsCount: chunkAnalysis.keyConceptsRelationships.length,
      });

      await this.tokenUsageService.recordTokenUsage({
        tokens: chunkAnalysis.tokens,
        type: TokenUsageType.GraphCreator,
        relationshipId: params.id,
        relationshipType: params.type,
      });

      await this.retryWithExponentialBackoff(
        async () => {
          const keyConcepts: Set<string> = new Set<string>();
          chunkAnalysis.atomicFacts.forEach((atomicFact) => {
            atomicFact.keyConcepts.forEach((keyConcept) => keyConcepts.add(keyConcept));
          });

          await this.keyConceptRepository.createOrphanKeyConcepts({
            keyConceptValues: Array.from(keyConcepts),
          });

          this.tracer.addSpanEvent("Write Key Concepts in Database");

          for (const atomicFact of chunkAnalysis.atomicFacts) {
            await this.atomicFactService.createAtomicFact({
              chunkId: chunk.id,
              content: atomicFact.content,
              keyConcepts: atomicFact.keyConcepts,
            });
          }
          this.tracer.addSpanEvent("Write Atomic Facts in Database");

          await this.keyConceptService.addKeyConceptRelationships({
            companyId: this.clsService.get("companyId"),
            chunkId: chunk.id,
            relationships: chunkAnalysis.keyConceptsRelationships.map((relationship) => {
              return {
                keyConcept1: relationship.keyConcept1,
                keyConcept2: relationship.keyConcept2,
                relationship: relationship.relationship,
              };
            }),
          });

          this.tracer.addSpanEvent("Write Key Concept Relationships in Database");
        },
        3,
        1000,
        `graph creation for chunk ${params.chunkId}`,
      );
    } else {
      this.logger.warn("Chunk analysis returned null - content was rejected by graph creator", "ChunkService", {
        chunkId: params.chunkId,
        contentLength: chunk.content?.length || 0,
        contentPreview: chunk.content?.substring(0, 200) || "",
        message: "Check GraphCreatorService logs for rejection reason",
      });
    }

    this.tracer.addSpanEvent("Graph Generated");

    await this.chunkRepository.updateStatus({
      id: chunk.id,
      aiStatus: AiStatus.Completed,
    });

    this.tracer.addSpanEvent("Update Chunk Status");

    const nextJobType = this.jobNames.process[params.type];
    this.logger.debug("Chunk processing completed, queuing next job", "ChunkService", {
      chunkId: params.chunkId,
      hadAnalysis: !!chunkAnalysis,
      nextJobType,
      relationshipId: params.id,
    });

    this.tracer.endSpan();

    const queue = this.selectQueue(params.type);
    await queue.add(nextJobType, {
      id: params.id,
      companyId: params.companyId,
      userId: params.userId,
    });
  }

  /**
   * Dynamically selects the queue based on content type.
   * Uses convention: labelName.toLowerCase() = queue ID
   * e.g., "Article" -> "article" queue
   */
  private selectQueue(type: string): Queue {
    const queueName = type.toLowerCase();
    try {
      const queue = this.moduleRef.get<Queue>(getQueueToken(queueName), { strict: false });
      if (!queue) {
        throw new Error(`Queue "${queueName}" not found for content type "${type}"`);
      }
      return queue;
    } catch (error) {
      this.logger.error(`Failed to get queue for type "${type}": ${error.message}`, "ChunkService");
      throw new Error(
        `No queue found for type ${type}. Ensure queue "${queueName}" is registered in chunkQueues.queueIds config.`,
      );
    }
  }
}
