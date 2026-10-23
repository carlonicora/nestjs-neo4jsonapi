import { BullModule } from "@nestjs/bullmq";
import { DynamicModule, Module, OnModuleInit } from "@nestjs/common";
import { createWorkerProvider } from "../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../common/registries/registry";
import { QueueId } from "../../config/enums/queue.id";
import { BlockNoteModule } from "../../core/blocknote/blocknote.module";
import { AuditModule } from "../audit/audit.module";
import { S3Module } from "../s3/s3.module";
import { TokenUsageModule } from "../tokenusage/tokenusage.module";
import { BlogCategoryTranslationController } from "./controllers/blog-category-translation.controller";
import { BlogCategoryController } from "./controllers/blog-category.controller";
import { BlogPostTranslationController } from "./controllers/blog-post-translation.controller";
import { BlogPostController } from "./controllers/blog-post.controller";
import { BlogSettingsController } from "./controllers/blog-settings.controller";
import { BlogPublicController } from "./controllers/blog.public.controller";
import { BlogCategoryDescriptor } from "./entities/blog-category";
import { BlogCategoryTranslationDescriptor } from "./entities/blog-category-translation";
import { BlogPostDescriptor } from "./entities/blog-post";
import { BlogPostTranslationDescriptor } from "./entities/blog-post-translation";
import { BlogSettingsDescriptor } from "./entities/blog-settings";
import { BlogModuleConfig, DEFAULT_BLOG_CONFIG } from "./interfaces/blog.config.interface";
import { BlogProcessor } from "./processors/blog.processor";
import { BlogCategoryTranslationRepository } from "./repositories/blog-category-translation.repository";
import { BlogCategoryRepository } from "./repositories/blog-category.repository";
import { BlogPostTranslationRepository } from "./repositories/blog-post-translation.repository";
import { BlogPostRepository } from "./repositories/blog-post.repository";
import { BlogSettingsRepository } from "./repositories/blog-settings.repository";
import { BlogCategoryTranslationService } from "./services/blog-category-translation.service";
import { BlogCategoryService } from "./services/blog-category.service";
import { BlogPostTranslationService } from "./services/blog-post-translation.service";
import { BlogPostService } from "./services/blog-post.service";
import { BlogQueueService } from "./services/blog-queue.service";
import { BlogSettingsService } from "./services/blog-settings.service";

/**
 * BlogModule — Administrator-written posts and categories, AI-translated into
 * every supported language by the blog worker, plus an OPT-IN unauthenticated
 * read surface.
 *
 * The static metadata mounts the five admin controllers only. With `forRoot()`
 * and no config, `BlogPublicController` is NOT registered and no `public/blog-*`
 * route exists.
 *
 * @example
 * ```typescript
 * BlogModule.forRoot()                         // admin routes only
 * BlogModule.forRoot({ publicRoutes: true })   // adds the public read routes
 * FoundationsModule.forRoot({ blog: { publicRoutes: true } })
 * ```
 */
@Module({
  controllers: [
    BlogPostController,
    BlogPostTranslationController,
    BlogCategoryController,
    BlogCategoryTranslationController,
    BlogSettingsController,
  ],
  providers: [
    BlogPostDescriptor.model.serialiser,
    BlogPostTranslationDescriptor.model.serialiser,
    BlogCategoryDescriptor.model.serialiser,
    BlogCategoryTranslationDescriptor.model.serialiser,
    BlogSettingsDescriptor.model.serialiser,
    BlogPostRepository,
    BlogPostTranslationRepository,
    BlogCategoryRepository,
    BlogCategoryTranslationRepository,
    BlogSettingsRepository,
    BlogQueueService,
    BlogPostService,
    BlogPostTranslationService,
    BlogCategoryService,
    BlogCategoryTranslationService,
    BlogSettingsService,
    createWorkerProvider(BlogProcessor),
  ],
  exports: [
    BlogPostRepository,
    BlogPostTranslationRepository,
    BlogCategoryRepository,
    BlogCategoryTranslationRepository,
    BlogSettingsRepository,
    BlogPostService,
    BlogPostTranslationService,
    BlogCategoryService,
    BlogCategoryTranslationService,
    BlogSettingsService,
  ],
  imports: [
    // defaultJobOptions are restated in full on purpose: a per-queue block
    // REPLACES QueueModule's global one rather than merging with it.
    BullModule.registerQueue({
      name: QueueId.BLOG,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: { age: 3600, count: 1000 },
      },
    }),
    AuditModule,
    BlockNoteModule,
    S3Module,
    TokenUsageModule,
  ],
})
export class BlogModule implements OnModuleInit {
  /**
   * Configure the BlogModule.
   *
   * @param config - Optional configuration merged over DEFAULT_BLOG_CONFIG
   */
  static forRoot(config?: BlogModuleConfig): DynamicModule {
    const mergedConfig: Required<BlogModuleConfig> = { ...DEFAULT_BLOG_CONFIG, ...config };

    return {
      module: BlogModule,
      // Nest concatenates this with the decorator's controllers, so only the
      // opt-in addition is listed here.
      controllers: mergedConfig.publicRoutes ? [BlogPublicController] : [],
    };
  }

  onModuleInit() {
    modelRegistry.register(BlogPostDescriptor.model);
    modelRegistry.register(BlogPostTranslationDescriptor.model);
    modelRegistry.register(BlogCategoryDescriptor.model);
    modelRegistry.register(BlogCategoryTranslationDescriptor.model);
    modelRegistry.register(BlogSettingsDescriptor.model);
  }
}
