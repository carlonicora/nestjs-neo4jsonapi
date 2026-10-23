import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { z } from "zod";
import { AiStatus } from "../../../common/enums/ai.status";
import { QueueId } from "../../../config/enums/queue.id";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { ModelWeight } from "../../../core/llm/enums/model.weight";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { TokenUsageType } from "../../tokenusage/enums/tokenusage.type";
import { BlogJobName } from "../blog.constants";
import { blogCategoryMeta } from "../entities/blog-category.meta";
import { blogPostMeta } from "../entities/blog-post.meta";
import { BLOG_SUMMARY_SYSTEM_PROMPT } from "../prompts/blog-summary.prompt";
import { BLOG_TRANSLATE_SYSTEM_PROMPT } from "../prompts/blog-translate.prompt";
import { BlogCategoryTranslationRepository } from "../repositories/blog-category-translation.repository";
import { BlogPostTranslationRepository } from "../repositories/blog-post-translation.repository";
import { BlogPostRepository } from "../repositories/blog-post.repository";
import { BlogQueueService } from "../services/blog-queue.service";
import { readingMinutes } from "../utils/reading-time";
import { slugify, uniqueSlug } from "../utils/slug";

type ProcessPostPayload = { postId: string; generateSummary: boolean; languages: string[] };
type TranslatePostPayload = { postId: string; language: string };
type ProcessCategoryPayload = { categoryId: string; languages: string[] };
type TranslateCategoryPayload = { categoryId: string; language: string };

// ---------------------------------------------------------------------------
// LLM contracts
// ---------------------------------------------------------------------------

export const blogSummaryInputSchema = z.object({
  language: z.string().describe("ISO 639-1 code of the language the summary MUST be written in."),
  title: z.string().describe("The article title. Context only: the summary must not repeat it."),
  body_markdown: z.string().describe("The full article body as markdown. The ONLY source of facts for the summary."),
});

export const blogSummaryOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      "One or two sentences, at most 160 characters, in the given language, stating what the reader will learn. No quotes, no title repetition.",
    ),
});

export const blogPostTranslateInputSchema = z.object({
  source_language: z.string().describe("ISO 639-1 code of the language every text field below is written in."),
  target_language: z.string().describe("ISO 639-1 code of the language every output field MUST be written in."),
  title: z.string().describe("The article title, to translate."),
  summary: z.string().describe("The one or two sentence article summary, to translate. Empty when there is none."),
  cover_image_alt: z
    .string()
    .describe("The description of the cover image for screen readers, to translate. Empty when there is none."),
  segments: z
    .array(z.string())
    .describe(
      "Ordered text fragments of one article; translate each in place, keep the count and order, keep inline whitespace at the edges.",
    ),
  previous_rejection: z
    .string()
    .describe(
      "Empty on the first attempt. Otherwise the reason the previous answer was rejected (it returned the wrong number of fragments); return exactly one translated fragment per input fragment this time.",
    ),
});

export const blogPostTranslateOutputSchema = z.object({
  title: z.string().describe("The title translated into the target language."),
  summary: z
    .string()
    .describe("The summary translated into the target language. Empty when the input summary is empty."),
  coverImageAlt: z
    .string()
    .describe("The cover image description translated into the target language. Empty when the input one is empty."),
  segments: z
    .array(z.string())
    .describe(
      "The translated fragments: exactly one per input fragment, in the same order, each keeping the leading and trailing spaces of its source fragment.",
    ),
});

export const blogCategoryTranslateInputSchema = z.object({
  source_language: z.string().describe("ISO 639-1 code of the language every text field below is written in."),
  target_language: z.string().describe("ISO 639-1 code of the language every output field MUST be written in."),
  name: z.string().describe("The blog category name, a short label, to translate."),
  description: z.string().describe("The blog category description, to translate. Empty when there is none."),
});

export const blogCategoryTranslateOutputSchema = z.object({
  name: z.string().describe("The category name translated into the target language, still a short label."),
  description: z
    .string()
    .describe("The category description translated into the target language. Empty when the input one is empty."),
});

/**
 * Worker for the blog AI jobs: summary generation and per-language translation of posts and
 * categories.
 *
 * Blog content is platform content: jobs carry no companyId and none is ever set in CLS, so token
 * usage is recorded against the post or category and no company is charged.
 */
@Processor(QueueId.BLOG, { concurrency: 4, lockDuration: 1000 * 60 * 5 })
export class BlogProcessor extends WorkerHost {
  constructor(
    private readonly logger: AppLoggingService,
    private readonly cls: ClsService,
    private readonly llmService: LLMService,
    private readonly blockNoteService: BlockNoteService,
    private readonly blogPostRepository: BlogPostRepository,
    private readonly blogPostTranslationRepository: BlogPostTranslationRepository,
    private readonly blogCategoryTranslationRepository: BlogCategoryTranslationRepository,
    private readonly blogQueueService: BlogQueueService,
  ) {
    super();
  }

  @OnWorkerEvent("active")
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} job (ID: ${job.id})`);
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job) {
    this.logger.debug(`Completed ${job.name} job (ID: ${job.id})`);
  }

  /**
   * Runs on every failed attempt. Only after the last attempt does it mark the affected
   * languages `failed`, so the admin sees the mark and the "Translate again" button.
   */
  @OnWorkerEvent("failed")
  async onFailed(job: Job, err: Error): Promise<void> {
    const attemptsUsed = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;

    this.logger.error(
      `Error processing ${job.name} job (ID: ${job.id}, attempt ${attemptsUsed}/${maxAttempts}). Reason: ${err?.message}`,
    );

    if (attemptsUsed < maxAttempts) return;

    await this.cls.run(async () => {
      this.cls.set("isAutomatedJob", true);

      switch (job.name) {
        case BlogJobName.ProcessPost:
          await this.blogPostTranslationRepository.setAiStatus({
            postId: job.data.postId,
            languages: job.data.languages ?? [],
            aiStatus: AiStatus.Failed,
          });
          break;
        case BlogJobName.TranslatePost:
          await this.blogPostTranslationRepository.setAiStatus({
            postId: job.data.postId,
            languages: [job.data.language],
            aiStatus: AiStatus.Failed,
          });
          break;
        case BlogJobName.ProcessCategory:
          await this.blogCategoryTranslationRepository.setAiStatus({
            categoryId: job.data.categoryId,
            languages: job.data.languages ?? [],
            aiStatus: AiStatus.Failed,
          });
          break;
        case BlogJobName.TranslateCategory:
          await this.blogCategoryTranslationRepository.setAiStatus({
            categoryId: job.data.categoryId,
            languages: [job.data.language],
            aiStatus: AiStatus.Failed,
          });
          break;
      }
    });
  }

  async process(job: Job): Promise<void> {
    await this.cls.run(async () => {
      this.cls.set("isAutomatedJob", true);

      switch (job.name) {
        case BlogJobName.ProcessPost:
          return this._processPost(job.data as ProcessPostPayload);
        case BlogJobName.TranslatePost:
          return this._translatePost(job.data as TranslatePostPayload);
        case BlogJobName.ProcessCategory:
          return this._processCategory(job.data as ProcessCategoryPayload);
        case BlogJobName.TranslateCategory:
          return this._translateCategory(job.data as TranslateCategoryPayload);
        default:
          throw new Error(`Job ${job.name} not handled by BlogProcessor`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Posts
  // ---------------------------------------------------------------------------

  private async _processPost(params: ProcessPostPayload): Promise<void> {
    if (params.generateSummary) {
      const original = await this.blogPostTranslationRepository.findOriginal({ postId: params.postId });
      if (!original) {
        this.logger.warn(`Blog post ${params.postId} has no original translation; skipping summary`);
      } else {
        const body = original.body ?? "[]";
        const result = await this.llmService.call<z.infer<typeof blogSummaryOutputSchema>>({
          inputSchema: blogSummaryInputSchema,
          inputParams: {
            language: original.language,
            title: original.title ?? "",
            body_markdown: this.blockNoteService.convertToMarkdown({ nodes: this._parseBlocks(body) }),
          },
          outputSchema: blogSummaryOutputSchema,
          systemPrompts: [BLOG_SUMMARY_SYSTEM_PROMPT],
          modelWeight: ModelWeight.Normal,
          temperature: 0.4,
          reasoningEffort: "low",
          timeout: 60_000,
          skipResponseLanguage: true,
          tokenUsageType: TokenUsageType.BlogSummary,
          relationshipId: params.postId,
          relationshipType: blogPostMeta.labelName,
          metadata: { agentName: "blog", nodeName: "summary" },
        });

        await this.blogPostTranslationRepository.updateText({
          id: original.id,
          title: original.title ?? "",
          slug: original.slug ?? "",
          summary: result.summary.trim(),
          body,
          bodyText: original.bodyText ?? "",
          coverImageAlt: original.coverImageAlt,
          readingMinutes: original.readingMinutes ?? readingMinutes(original.bodyText ?? ""),
        });
      }
    }

    for (const language of params.languages) {
      await this.blogQueueService.enqueuePostLanguage({ postId: params.postId, language });
    }
  }

  private async _translatePost(params: TranslatePostPayload): Promise<void> {
    const original = await this.blogPostTranslationRepository.findOriginal({ postId: params.postId });
    if (!original) {
      this.logger.warn(`Blog post ${params.postId} has no original translation; skipping ${params.language}`);
      return;
    }
    if (original.language === params.language) return;

    await this.blogPostTranslationRepository.setAiStatus({
      postId: params.postId,
      languages: [params.language],
      aiStatus: AiStatus.InProgress,
    });

    const post = await this.blogPostRepository.findById({ id: params.postId });
    const existing = await this.blogPostTranslationRepository.findByPostAndLanguage({
      postId: params.postId,
      language: params.language,
    });

    const blocks = this._parseBlocks(original.body ?? "[]");
    const segments = this.blockNoteService.extractTextSegments(blocks);

    const callTranslate = (previousRejection: string) =>
      this.llmService.call<z.infer<typeof blogPostTranslateOutputSchema>>({
        inputSchema: blogPostTranslateInputSchema,
        inputParams: {
          source_language: original.language,
          target_language: params.language,
          title: original.title ?? "",
          summary: original.summary ?? "",
          cover_image_alt: original.coverImageAlt ?? "",
          segments,
          previous_rejection: previousRejection,
        },
        outputSchema: blogPostTranslateOutputSchema,
        systemPrompts: [BLOG_TRANSLATE_SYSTEM_PROMPT],
        modelWeight: ModelWeight.Normal,
        temperature: 0.2,
        reasoningEffort: "low",
        timeout: 180_000,
        skipResponseLanguage: true,
        tokenUsageType: TokenUsageType.BlogTranslation,
        relationshipId: params.postId,
        relationshipType: blogPostMeta.labelName,
        metadata: { agentName: "blog", nodeName: "translate" },
      });

    // A different fragment count is a structurally unusable output (a failure, not a quality
    // judgement). Re-ask once with the rejection named in the input; if that answer is also
    // unusable, applyTextSegments throws, nothing is written and BullMQ retries the job.
    let result = await callTranslate("");
    if ((result.segments ?? []).length !== segments.length) {
      this.logger.warn(
        `Blog translation ${params.postId}/${params.language}: ${result.segments?.length ?? 0} fragments for ${segments.length}; re-asking`,
      );
      result = await callTranslate(
        `The previous answer returned ${result.segments?.length ?? 0} fragments for ${segments.length} input fragments.`,
      );
    }
    const translatedBlocks = this.blockNoteService.applyTextSegments(blocks, result.segments ?? []);
    const bodyText = this.blockNoteService.convertToPlainText({ nodes: translatedBlocks as any[] });

    const keepSlug = !!existing?.slug && post?.status === "published";
    const slug = keepSlug
      ? (existing!.slug as string)
      : await this._uniquePostSlug({
          title: result.title,
          language: params.language,
          excludeTranslationId: existing?.id,
        });

    await this.blogPostTranslationRepository.writeAiTranslation({
      postId: params.postId,
      language: params.language,
      title: result.title,
      slug,
      summary: result.summary || undefined,
      body: JSON.stringify(translatedBlocks),
      bodyText,
      coverImageAlt: result.coverImageAlt || undefined,
      readingMinutes: readingMinutes(bodyText),
    });
  }

  private async _uniquePostSlug(params: {
    title: string;
    language: string;
    excludeTranslationId?: string;
  }): Promise<string> {
    const base = slugify(params.title);
    const taken = await this.blogPostTranslationRepository.findSlugsWithPrefix({
      language: params.language,
      prefix: base,
      excludeTranslationId: params.excludeTranslationId,
    });
    return uniqueSlug(base, taken);
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  private async _processCategory(params: ProcessCategoryPayload): Promise<void> {
    for (const language of params.languages) {
      await this.blogQueueService.enqueueCategoryLanguage({ categoryId: params.categoryId, language });
    }
  }

  private async _translateCategory(params: TranslateCategoryPayload): Promise<void> {
    const original = await this.blogCategoryTranslationRepository.findOriginal({ categoryId: params.categoryId });
    if (!original) {
      this.logger.warn(`Blog category ${params.categoryId} has no original translation; skipping ${params.language}`);
      return;
    }
    if (original.language === params.language) return;

    await this.blogCategoryTranslationRepository.setAiStatus({
      categoryId: params.categoryId,
      languages: [params.language],
      aiStatus: AiStatus.InProgress,
    });

    const existing = await this.blogCategoryTranslationRepository.findByCategoryAndLanguage({
      categoryId: params.categoryId,
      language: params.language,
    });

    const result = await this.llmService.call<z.infer<typeof blogCategoryTranslateOutputSchema>>({
      inputSchema: blogCategoryTranslateInputSchema,
      inputParams: {
        source_language: original.language,
        target_language: params.language,
        name: original.name ?? "",
        description: original.description ?? "",
      },
      outputSchema: blogCategoryTranslateOutputSchema,
      systemPrompts: [BLOG_TRANSLATE_SYSTEM_PROMPT],
      modelWeight: ModelWeight.Normal,
      temperature: 0.2,
      reasoningEffort: "low",
      timeout: 60_000,
      skipResponseLanguage: true,
      tokenUsageType: TokenUsageType.BlogTranslation,
      relationshipId: params.categoryId,
      relationshipType: blogCategoryMeta.labelName,
      metadata: { agentName: "blog", nodeName: "translate" },
    });

    // Categories are always public (the filter link carries the slug), so an existing slug is
    // kept, exactly like a published post's.
    let slug = existing?.slug;
    if (!slug) {
      const base = slugify(result.name);
      const taken = await this.blogCategoryTranslationRepository.findSlugsWithPrefix({
        language: params.language,
        prefix: base,
        excludeTranslationId: existing?.id,
      });
      slug = uniqueSlug(base, taken);
    }

    await this.blogCategoryTranslationRepository.writeAiTranslation({
      categoryId: params.categoryId,
      language: params.language,
      name: result.name,
      slug,
      description: result.description || undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _parseBlocks(body: string): unknown[] {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [];
  }
}
