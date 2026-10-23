import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { AiStatus } from "../../../common/enums/ai.status";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { ModelWeight } from "../../../core/llm/enums/model.weight";
import { LLMService } from "../../../core/llm/services/llm.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { BLOG_TRANSLATE_SYSTEM_PROMPT } from "../prompts/blog-translate.prompt";
import { BlogJobName } from "../blog.constants";
import { BlogCategoryTranslation } from "../entities/blog-category-translation";
import { BlogPost } from "../entities/blog-post";
import { BlogPostTranslation } from "../entities/blog-post-translation";
import { BlogCategoryTranslationRepository } from "../repositories/blog-category-translation.repository";
import { BlogPostTranslationRepository } from "../repositories/blog-post-translation.repository";
import { BlogPostRepository } from "../repositories/blog-post.repository";
import { BlogQueueService } from "../services/blog-queue.service";
import { BlogProcessor } from "./blog.processor";

const BODY = JSON.stringify([
  {
    type: "heading",
    content: [{ type: "text", text: "Hello", styles: { bold: true } }],
    children: [
      {
        type: "paragraph",
        content: [{ type: "link", href: "https://x", content: [{ type: "text", text: "link" }] }],
        children: [],
      },
    ],
  },
]);

const ORIGINAL = {
  id: "t-en",
  language: "en",
  isOriginal: true,
  title: "Title",
  slug: "title",
  summary: "Summary",
  body: BODY,
  bodyText: "Hello link",
  coverImageAlt: "Alt",
  readingMinutes: 1,
};

describe("BlogProcessor", () => {
  let processor: BlogProcessor;
  let logger: Mocked<Pick<AppLoggingService, "debug" | "warn" | "error">>;
  let cls: Mocked<Pick<ClsService, "run" | "set" | "get">>;
  let llm: Mocked<Pick<LLMService, "call">>;
  let blockNote: Mocked<
    Pick<BlockNoteService, "convertToMarkdown" | "convertToPlainText" | "extractTextSegments" | "applyTextSegments">
  >;
  let postRepo: Mocked<Pick<BlogPostRepository, "findById">>;
  let translationRepo: Mocked<
    Pick<
      BlogPostTranslationRepository,
      | "findOriginal"
      | "findByPostAndLanguage"
      | "findSlugsWithPrefix"
      | "setAiStatus"
      | "updateText"
      | "writeAiTranslation"
    >
  >;
  let categoryTranslationRepo: Mocked<
    Pick<
      BlogCategoryTranslationRepository,
      "findOriginal" | "findByCategoryAndLanguage" | "findSlugsWithPrefix" | "setAiStatus" | "writeAiTranslation"
    >
  >;
  let queue: Mocked<Pick<BlogQueueService, "enqueuePostLanguage" | "enqueueCategoryLanguage">>;

  /** An LLMService.call result: the parsed output plus the usage fields every call returns. */
  const llmResult = <T extends object>(output: T) => ({
    ...output,
    tokenUsage: { input: 0, output: 0 },
    modelWeight: ModelWeight.Normal,
  });

  const job = (name: string, data: Record<string, unknown>): Job =>
    ({ id: "job-1", name, data, attemptsMade: 0, opts: { attempts: 3 } }) as unknown as Job;

  const jobWith = (overrides: Record<string, unknown>): Job =>
    ({
      id: "job-1",
      name: BlogJobName.TranslatePost,
      data: { postId: "p", language: "it" },
      ...overrides,
    }) as unknown as Job;

  beforeEach(() => {
    const realBlockNote = new BlockNoteService();
    logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    cls = {
      run: vi.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
      set: vi.fn(),
      get: vi.fn(),
    } as typeof cls;
    llm = { call: vi.fn() } as typeof llm;
    blockNote = {
      convertToMarkdown: vi.fn().mockReturnValue("# Hello\n\n[link](https://x)"),
      convertToPlainText: vi.fn().mockReturnValue("Ciao collegamento"),
      extractTextSegments: vi.fn().mockImplementation((blocks: unknown[]) => realBlockNote.extractTextSegments(blocks)),
      applyTextSegments: vi
        .fn()
        .mockImplementation((blocks: unknown[], segments: string[]) =>
          realBlockNote.applyTextSegments(blocks, segments),
        ),
    };
    postRepo = {
      findById: vi.fn().mockResolvedValue({ id: "p", status: "draft", originalLanguage: "en" } as BlogPost),
    };
    translationRepo = {
      findOriginal: vi.fn().mockImplementation(async () => ({ ...ORIGINAL }) as BlogPostTranslation),
      findByPostAndLanguage: vi.fn().mockResolvedValue({ id: "t-it", language: "it" } as BlogPostTranslation),
      findSlugsWithPrefix: vi.fn().mockResolvedValue([]),
      setAiStatus: vi.fn().mockResolvedValue(undefined),
      updateText: vi.fn().mockResolvedValue(undefined),
      writeAiTranslation: vi.fn().mockResolvedValue(undefined),
    };
    categoryTranslationRepo = {
      findOriginal: vi
        .fn()
        .mockImplementation(
          async () =>
            ({ id: "c-en", language: "en", name: "Prep", slug: "prep", description: "D" }) as BlogCategoryTranslation,
        ),
      findByCategoryAndLanguage: vi.fn().mockResolvedValue(null),
      findSlugsWithPrefix: vi.fn().mockResolvedValue([]),
      setAiStatus: vi.fn().mockResolvedValue(undefined),
      writeAiTranslation: vi.fn().mockResolvedValue(undefined),
    };
    queue = {
      enqueuePostLanguage: vi.fn().mockResolvedValue(undefined),
      enqueueCategoryLanguage: vi.fn().mockResolvedValue(undefined),
    };

    processor = new BlogProcessor(
      logger as unknown as AppLoggingService,
      cls as unknown as ClsService,
      llm as unknown as LLMService,
      blockNote as unknown as BlockNoteService,
      postRepo as unknown as BlogPostRepository,
      translationRepo as unknown as BlogPostTranslationRepository,
      categoryTranslationRepo as unknown as BlogCategoryTranslationRepository,
      queue as unknown as BlogQueueService,
    );
  });

  describe("translate post", () => {
    it("translate job writes an AI translation with the applied segments", async () => {
      llm.call.mockResolvedValue(
        llmResult({
          title: "Titolo",
          summary: "Riassunto",
          coverImageAlt: "Alt",
          segments: ["Ciao", "collegamento"],
        }),
      );

      await processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "it" }));

      expect(translationRepo.writeAiTranslation).toHaveBeenCalledWith(
        expect.objectContaining({ postId: "p", language: "it", title: "Titolo", slug: "titolo" }),
      );
      const written = translationRepo.writeAiTranslation.mock.calls[0][0];
      const body = JSON.parse(written.body);
      expect(body[0].content[0]).toEqual({ type: "text", text: "Ciao", styles: { bold: true } });
      expect(body[0].children[0].content[0]).toMatchObject({ href: "https://x", content: [{ text: "collegamento" }] });

      expect(llm.call).toHaveBeenCalledWith(
        expect.objectContaining({
          relationshipId: "p",
          relationshipType: "BlogPost",
          tokenUsageType: "blog_translation",
          inputSchema: expect.anything(),
          outputSchema: expect.anything(),
          systemPrompts: [BLOG_TRANSLATE_SYSTEM_PROMPT],
          metadata: { agentName: "blog", nodeName: "translate" },
          inputParams: expect.objectContaining({
            source_language: "en",
            target_language: "it",
            segments: ["Hello", "link"],
          }),
        }),
      );
    });

    it("marks the language in progress before calling the model", async () => {
      llm.call.mockResolvedValue(llmResult({ title: "T", summary: "", coverImageAlt: "", segments: ["a", "b"] }));

      await processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "it" }));

      expect(translationRepo.setAiStatus).toHaveBeenCalledWith({
        postId: "p",
        languages: ["it"],
        aiStatus: AiStatus.InProgress,
      });
      expect(translationRepo.setAiStatus.mock.invocationCallOrder[0]).toBeLessThan(
        llm.call.mock.invocationCallOrder[0],
      );
    });

    it("translate job throws on a segment mismatch and writes nothing", async () => {
      llm.call.mockResolvedValue(llmResult({ title: "T", summary: "", coverImageAlt: "", segments: ["only one"] }));

      await expect(processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "it" }))).rejects.toThrow(
        "segment count mismatch",
      );
      expect(translationRepo.writeAiTranslation).not.toHaveBeenCalled();
      expect(llm.call).toHaveBeenCalledTimes(2);
      expect(llm.call.mock.calls[1][0].inputParams.previous_rejection).toContain("returned 1 fragments");
    });

    it("re-asks once with the rejection and writes the corrected answer", async () => {
      llm.call
        .mockResolvedValueOnce(llmResult({ title: "Titolo", summary: "", coverImageAlt: "", segments: ["only one"] }))
        .mockResolvedValueOnce(
          llmResult({ title: "Titolo", summary: "", coverImageAlt: "", segments: ["Ciao", "collegamento"] }),
        );

      await processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "it" }));

      expect(llm.call.mock.calls[0][0].inputParams.previous_rejection).toBe("");
      expect(translationRepo.writeAiTranslation).toHaveBeenCalledWith(expect.objectContaining({ title: "Titolo" }));
    });

    it("keeps the existing slug of a published post", async () => {
      postRepo.findById.mockResolvedValue({ id: "p", status: "published", originalLanguage: "en" } as BlogPost);
      translationRepo.findByPostAndLanguage.mockResolvedValue({
        id: "t-it",
        language: "it",
        slug: "vecchio-titolo",
      } as BlogPostTranslation);
      llm.call.mockResolvedValue(
        llmResult({ title: "Nuovo titolo", summary: "", coverImageAlt: "", segments: ["a", "b"] }),
      );

      await processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "it" }));

      expect(translationRepo.writeAiTranslation).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "vecchio-titolo", title: "Nuovo titolo" }),
      );
      expect(translationRepo.findSlugsWithPrefix).not.toHaveBeenCalled();
    });

    it("regenerates the slug of an unpublished post", async () => {
      translationRepo.findByPostAndLanguage.mockResolvedValue({
        id: "t-it",
        language: "it",
        slug: "vecchio-titolo",
      } as BlogPostTranslation);
      llm.call.mockResolvedValue(
        llmResult({ title: "Nuovo titolo", summary: "", coverImageAlt: "", segments: ["a", "b"] }),
      );

      await processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "it" }));

      expect(translationRepo.findSlugsWithPrefix).toHaveBeenCalledWith({
        language: "it",
        prefix: "nuovo-titolo",
        excludeTranslationId: "t-it",
      });
      expect(translationRepo.writeAiTranslation).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "nuovo-titolo" }),
      );
    });

    it("suffixes a slug already taken in the same language", async () => {
      translationRepo.findSlugsWithPrefix.mockResolvedValue(["titolo"]);
      llm.call.mockResolvedValue(llmResult({ title: "Titolo", summary: "", coverImageAlt: "", segments: ["a", "b"] }));

      await processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "it" }));

      expect(translationRepo.writeAiTranslation).toHaveBeenCalledWith(expect.objectContaining({ slug: "titolo-2" }));
    });

    it("skips the original language", async () => {
      await processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "en" }));

      expect(llm.call).not.toHaveBeenCalled();
      expect(translationRepo.writeAiTranslation).not.toHaveBeenCalled();
    });
  });

  describe("process post", () => {
    it("process job writes the summary then queues one job per language", async () => {
      llm.call.mockResolvedValue(llmResult({ summary: "What you will learn." }));

      await processor.process(job(BlogJobName.ProcessPost, { postId: "p", generateSummary: true, languages: ["it"] }));

      expect(translationRepo.updateText).toHaveBeenCalledWith(
        expect.objectContaining({ id: "t-en", summary: expect.any(String), slug: "title", body: BODY }),
      );
      expect(llm.call).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenUsageType: "blog_summary",
          relationshipId: "p",
          relationshipType: "BlogPost",
          inputSchema: expect.anything(),
          metadata: { agentName: "blog", nodeName: "summary" },
        }),
      );
      expect(queue.enqueuePostLanguage).toHaveBeenCalledWith({ postId: "p", language: "it" });
      expect(translationRepo.updateText.mock.invocationCallOrder[0]).toBeLessThan(
        queue.enqueuePostLanguage.mock.invocationCallOrder[0],
      );
    });

    it("does not call the model when no summary is needed", async () => {
      await processor.process(
        job(BlogJobName.ProcessPost, { postId: "p", generateSummary: false, languages: ["it", "de"] }),
      );

      expect(llm.call).not.toHaveBeenCalled();
      expect(translationRepo.updateText).not.toHaveBeenCalled();
      expect(queue.enqueuePostLanguage).toHaveBeenCalledTimes(2);
    });
  });

  describe("categories", () => {
    it("process category queues one job per language", async () => {
      await processor.process(job(BlogJobName.ProcessCategory, { categoryId: "c", languages: ["it"] }));

      expect(queue.enqueueCategoryLanguage).toHaveBeenCalledWith({ categoryId: "c", language: "it" });
    });

    it("translate category writes name, slug and description", async () => {
      llm.call.mockResolvedValue(llmResult({ name: "Preparazione", description: "Descrizione" }));

      await processor.process(job(BlogJobName.TranslateCategory, { categoryId: "c", language: "it" }));

      expect(categoryTranslationRepo.writeAiTranslation).toHaveBeenCalledWith({
        categoryId: "c",
        language: "it",
        name: "Preparazione",
        slug: "preparazione",
        description: "Descrizione",
      });
      expect(llm.call).toHaveBeenCalledWith(
        expect.objectContaining({
          relationshipId: "c",
          relationshipType: "BlogCategory",
          tokenUsageType: "blog_translation",
        }),
      );
    });

    it("keeps an existing category slug", async () => {
      categoryTranslationRepo.findByCategoryAndLanguage.mockResolvedValue({
        id: "c-it",
        slug: "prep-it",
      } as BlogCategoryTranslation);
      llm.call.mockResolvedValue(llmResult({ name: "Preparazione", description: "" }));

      await processor.process(job(BlogJobName.TranslateCategory, { categoryId: "c", language: "it" }));

      expect(categoryTranslationRepo.writeAiTranslation).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "prep-it" }),
      );
    });
  });

  describe("failure", () => {
    it("onFailed marks the language failed only after the last attempt", async () => {
      await processor.onFailed(jobWith({ attemptsMade: 1, opts: { attempts: 3 } }), new Error("x"));
      expect(translationRepo.setAiStatus).not.toHaveBeenCalled();

      await processor.onFailed(jobWith({ attemptsMade: 3, opts: { attempts: 3 } }), new Error("x"));
      expect(translationRepo.setAiStatus).toHaveBeenCalledWith({
        postId: "p",
        languages: ["it"],
        aiStatus: AiStatus.Failed,
      });
    });

    it("onFailed marks every target of a failed process job", async () => {
      await processor.onFailed(
        jobWith({
          name: BlogJobName.ProcessPost,
          data: { postId: "p", generateSummary: true, languages: ["it", "de"] },
          attemptsMade: 3,
          opts: { attempts: 3 },
        }),
        new Error("x"),
      );

      expect(translationRepo.setAiStatus).toHaveBeenCalledWith({
        postId: "p",
        languages: ["it", "de"],
        aiStatus: AiStatus.Failed,
      });
    });

    it("onFailed marks a category language failed", async () => {
      await processor.onFailed(
        jobWith({
          name: BlogJobName.TranslateCategory,
          data: { categoryId: "c", language: "it" },
          attemptsMade: 3,
          opts: { attempts: 3 },
        }),
        new Error("x"),
      );

      expect(categoryTranslationRepo.setAiStatus).toHaveBeenCalledWith({
        categoryId: "c",
        languages: ["it"],
        aiStatus: AiStatus.Failed,
      });
    });

    it("rejects an unknown job name", async () => {
      await expect(processor.process(job("unknown_job", {}))).rejects.toThrow(
        "Job unknown_job not handled by BlogProcessor",
      );
    });
  });

  describe("CLS", () => {
    it("runs with no companyId in CLS", async () => {
      llm.call.mockResolvedValue(llmResult({ title: "T", summary: "", coverImageAlt: "", segments: ["a", "b"] }));

      await processor.process(job(BlogJobName.TranslatePost, { postId: "p", language: "it" }));
      await processor.onFailed(jobWith({ attemptsMade: 3, opts: { attempts: 3 } }), new Error("x"));

      expect(cls.run).toHaveBeenCalledTimes(2);
      expect(cls.set).toHaveBeenCalledWith("isAutomatedJob", true);
      expect(cls.set).not.toHaveBeenCalledWith("companyId", expect.anything());
    });
  });
});
