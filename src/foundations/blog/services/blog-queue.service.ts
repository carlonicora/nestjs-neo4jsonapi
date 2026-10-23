import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { QueueId } from "../../../config/enums/queue.id";
import { BlogJobName } from "../blog.constants";
import { BlogCategoryTranslationRepository } from "../repositories/blog-category-translation.repository";
import { BlogPostTranslationRepository } from "../repositories/blog-post-translation.repository";

/**
 * Enqueues the blog's AI jobs (summary + translation).
 *
 * Every enqueue first creates (or keeps) one placeholder translation per target
 * language in `pending`, so the admin sees "Translating…" at once.
 *
 * The payloads never carry `companyId`: the blog is platform content, so token
 * usage is recorded against the post or category and no company is charged.
 */
@Injectable()
export class BlogQueueService {
  constructor(
    @InjectQueue(QueueId.BLOG) private readonly queue: Queue,
    private readonly blogPostTranslationRepository: BlogPostTranslationRepository,
    private readonly blogCategoryTranslationRepository: BlogCategoryTranslationRepository,
  ) {}

  async enqueuePost(params: { postId: string; generateSummary: boolean; languages: string[] }): Promise<void> {
    await this.blogPostTranslationRepository.ensurePending({ postId: params.postId, languages: params.languages });
    await this.queue.add(BlogJobName.ProcessPost, {
      postId: params.postId,
      generateSummary: params.generateSummary,
      languages: params.languages,
    });
  }

  async enqueuePostLanguage(params: { postId: string; language: string }): Promise<void> {
    await this.blogPostTranslationRepository.ensurePending({ postId: params.postId, languages: [params.language] });
    await this.queue.add(BlogJobName.TranslatePost, { postId: params.postId, language: params.language });
  }

  async enqueueCategory(params: { categoryId: string; languages: string[] }): Promise<void> {
    await this.blogCategoryTranslationRepository.ensurePending({
      categoryId: params.categoryId,
      languages: params.languages,
    });
    await this.queue.add(BlogJobName.ProcessCategory, {
      categoryId: params.categoryId,
      languages: params.languages,
    });
  }

  async enqueueCategoryLanguage(params: { categoryId: string; language: string }): Promise<void> {
    await this.blogCategoryTranslationRepository.ensurePending({
      categoryId: params.categoryId,
      languages: [params.language],
    });
    await this.queue.add(BlogJobName.TranslateCategory, {
      categoryId: params.categoryId,
      language: params.language,
    });
  }
}
