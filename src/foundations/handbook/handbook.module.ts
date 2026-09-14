import { BullModule } from "@nestjs/bullmq";
import { DynamicModule, Module, OnModuleInit, Provider } from "@nestjs/common";
import { ResponderModule } from "../../agents/responder/responder.module";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { ModelService } from "../../core/llm/services/model.service";
import { AppLoggingService } from "../../core/logging/services/logging.service";
import { AuditModule } from "../audit/audit.module";
import { ChunkModule } from "../chunk/chunk.module";
import { ChunkerModule } from "../chunker/chunker.module";
import { HandbookController } from "./controllers/handbook.controller";
import { HandbookThreadController } from "./controllers/handbook-thread.controller";
import { HandbookPageDescriptor } from "./entities/handbook-page";
import { HandbookSectionDescriptor } from "./entities/handbook-section";
import { HandbookThreadDescriptor } from "./entities/handbook-thread";
import { HandbookThreadMessageDescriptor } from "./entities/handbook-thread-message";
import { DEFAULT_HANDBOOK_CONFIG, HANDBOOK_CONFIG, HandbookModuleConfig } from "./interfaces/handbook.config.interface";
import { HandbookProcessor } from "./processors/handbook.processor";
import { HandbookPageRepository } from "./repositories/handbook-page.repository";
import { HandbookSectionRepository } from "./repositories/handbook-section.repository";
import { HandbookThreadRepository } from "./repositories/handbook-thread.repository";
import { HandbookThreadMessageRepository } from "./repositories/handbook-thread-message.repository";
import { HandbookIngestService } from "./services/handbook-ingest.service";
import { HandbookPageService } from "./services/handbook-page.service";
import { HandbookSectionService } from "./services/handbook-section.service";
import { HandbookThreadService } from "./services/handbook-thread.service";
import { HandbookThreadMessageService } from "./services/handbook-thread-message.service";

/**
 * HandbookModule — administrator-only RAG over an application's own markdown
 * documentation, with persisted conversations.
 *
 * The queue is registered HERE rather than left to the consumer: the finalise
 * job ChunkService enqueues per chunk is routed by label, so a foundation that
 * does not register its own queue only works in applications that happen to
 * register it for us.
 */
@Module({})
export class HandbookModule implements OnModuleInit {
  static forRoot(config?: HandbookModuleConfig): DynamicModule {
    const mergedConfig: Required<HandbookModuleConfig> = { ...DEFAULT_HANDBOOK_CONFIG, ...config };

    const providers: Provider[] = [
      { provide: HANDBOOK_CONFIG, useValue: mergedConfig },
      HandbookPageDescriptor.model.serialiser,
      HandbookSectionDescriptor.model.serialiser,
      HandbookThreadDescriptor.model.serialiser,
      HandbookThreadMessageDescriptor.model.serialiser,
      HandbookPageRepository,
      HandbookSectionRepository,
      HandbookThreadRepository,
      HandbookThreadMessageRepository,
      HandbookPageService,
      HandbookSectionService,
      HandbookIngestService,
      HandbookThreadMessageService,
      HandbookThreadService,
      createWorkerProvider(HandbookProcessor),
    ];

    return {
      module: HandbookModule,
      controllers: [HandbookController, HandbookThreadController],
      providers,
      exports: [
        HandbookPageRepository,
        HandbookSectionRepository,
        HandbookPageService,
        HandbookSectionService,
        HandbookIngestService,
        HandbookThreadService,
        HandbookThreadMessageService,
      ],
      imports: [
        BullModule.registerQueue({
          name: QueueId.HANDBOOK_PAGE,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 10_000 },
            removeOnComplete: true,
            removeOnFail: { age: 3600, count: 1000 },
          },
        }),
        BullModule.registerQueue({
          name: QueueId.CHUNK,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 10_000 },
          },
        }),
        AuditModule,
        ChunkModule,
        ChunkerModule,
        // The handbook thread drives ResponderService directly rather than
        // going through the package Assistant: Assistant is company-scoped and
        // a platform administrator has no Company. ResponderModule declares no
        // controllers of its own, so importing it mounts no routes.
        ResponderModule,
      ],
    };
  }

  constructor(
    private readonly modelService: ModelService,
    private readonly logger: AppLoggingService,
  ) {}

  onModuleInit() {
    modelRegistry.register(HandbookPageDescriptor.model);
    modelRegistry.register(HandbookSectionDescriptor.model);
    modelRegistry.register(HandbookThreadDescriptor.model);
    modelRegistry.register(HandbookThreadMessageDescriptor.model);

    // Say it once at boot rather than only when someone presses Sync: an
    // installation with no AI configuration can browse pages it ingested
    // earlier, but can never ingest again, and that is worth knowing before
    // the button is pressed.
    if (!this.modelService.isAiConfigured())
      this.logger.warn("Handbook ingest is unavailable: no usable AI configuration.");
  }
}
