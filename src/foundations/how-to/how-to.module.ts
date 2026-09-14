import { BullModule } from "@nestjs/bullmq";
import { DynamicModule, Module, OnModuleInit } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { BlockNoteModule } from "../../core/blocknote/blocknote.module";
import { AuditModule } from "../audit/audit.module";
import { ChunkModule } from "../chunk/chunk.module";
import { ChunkerModule } from "../chunker/chunker.module";
import { TokenUsageModule } from "../tokenusage/tokenusage.module";
import { HowToController } from "./controllers/how-to.controller";
import { HowToPublicController } from "./controllers/how-to.public.controller";
import { HowToDescriptor } from "./entities/how-to";
import { DEFAULT_HOW_TO_CONFIG, HowToModuleConfig } from "./interfaces/how-to.config.interface";
import { HowToProcessor } from "./processors/how-to.processor";
import { HowToRepository } from "./repositories/how-to.repository";
import { HowToService } from "./services/how-to.service";

/**
 * HowToModule — authenticated CRUD over help articles, plus an OPT-IN
 * unauthenticated read surface.
 *
 * The static metadata below mounts `HowToController` only, so importing the
 * module as `HowToModule` (no `forRoot()`) publishes nothing: every route it
 * adds is behind `JwtAuthGuard`.
 *
 * Defaults are deliberately inert: with `forRoot()` and no config,
 * `HowToPublicController` is NOT registered and the three `public/howtos/*`
 * routes do not exist. Those routes are unauthenticated by design and their
 * read filter is `draft IS NULL OR draft = false`, which makes a guide created
 * without a `draft` property world-readable — publishing a company's guides is
 * an app-level policy decision, never a side effect of mounting the module.
 *
 * @example
 * ```typescript
 * // Inert (library default): authenticated CRUD only, no public routes
 * HowToModule
 * HowToModule.forRoot()
 *
 * // Public knowledge base: adds GET public/howtos and the article routes
 * HowToModule.forRoot({ publicRoutes: true })
 *
 * // Through FoundationsModule, which mounts this module for you
 * FoundationsModule.forRoot({ howTo: { publicRoutes: true } })
 * ```
 */
@Module({
  controllers: [HowToController],
  providers: [HowToDescriptor.model.serialiser, HowToRepository, HowToService, createWorkerProvider(HowToProcessor)],
  exports: [HowToRepository, HowToService],
  imports: [
    // HowToProcessor is a @Processor(QueueId.HOWTO) worker and ChunkService
    // routes each finalise job by label — `HowTo`.toLowerCase() — so this queue
    // must exist wherever this module is mounted. Registering it here rather
    // than expecting every consumer to add "howto" to its own chunkQueues
    // config: without it the first guide to be chunked dies in
    // ChunkService.selectQueue with "No queue found for type HowTo".
    //
    // defaultJobOptions are restated in full on purpose: a per-queue block
    // REPLACES QueueModule's global one rather than merging with it, so
    // omitting removeOnComplete/removeOnFail would silently retain every
    // finished job.
    BullModule.registerQueue({
      name: QueueId.HOWTO,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: { age: 3600, count: 1000 },
      },
    }),
    AuditModule,
    BlockNoteModule,
    ChunkModule,
    ChunkerModule,
    TokenUsageModule,
  ],
})
export class HowToModule implements OnModuleInit {
  /**
   * Configure the HowToModule.
   *
   * @param config - Optional configuration merged over DEFAULT_HOW_TO_CONFIG
   */
  static forRoot(config?: HowToModuleConfig): DynamicModule {
    const mergedConfig: Required<HowToModuleConfig> = { ...DEFAULT_HOW_TO_CONFIG, ...config };

    return {
      module: HowToModule,
      // Nest CONCATENATES a dynamic module's metadata onto the decorator's
      // (scanner.ts reads both `MODULE_METADATA.CONTROLLERS` and the dynamic
      // metadata for the same token), so only the opt-in addition is listed
      // here — everything the static form provides still applies. The public
      // controller is therefore the ONLY difference `forRoot()` can make, and
      // without `publicRoutes` there is none at all.
      controllers: mergedConfig.publicRoutes ? [HowToPublicController] : [],
    };
  }

  onModuleInit() {
    modelRegistry.register(HowToDescriptor.model);
  }
}
