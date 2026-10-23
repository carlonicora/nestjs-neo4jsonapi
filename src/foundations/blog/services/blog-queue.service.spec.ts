import { getQueueToken } from "@nestjs/bullmq";
import { Test } from "@nestjs/testing";
import { Queue } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { QueueId } from "../../../config/enums/queue.id";
import { BlogJobName } from "../blog.constants";
import { BlogCategoryTranslationRepository } from "../repositories/blog-category-translation.repository";
import { BlogPostTranslationRepository } from "../repositories/blog-post-translation.repository";
import { BlogQueueService } from "./blog-queue.service";

describe("BlogQueueService", () => {
  let service: BlogQueueService;
  let queue: Mocked<Pick<Queue, "add">>;
  let postTranslationRepo: Mocked<Pick<BlogPostTranslationRepository, "ensurePending">>;
  let categoryTranslationRepo: Mocked<Pick<BlogCategoryTranslationRepository, "ensurePending">>;

  beforeEach(async () => {
    queue = { add: vi.fn() };
    postTranslationRepo = { ensurePending: vi.fn() };
    categoryTranslationRepo = { ensurePending: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        BlogQueueService,
        { provide: getQueueToken(QueueId.BLOG), useValue: queue },
        { provide: BlogPostTranslationRepository, useValue: postTranslationRepo },
        { provide: BlogCategoryTranslationRepository, useValue: categoryTranslationRepo },
      ],
    }).compile();

    service = module.get(BlogQueueService);
  });

  afterEach(() => vi.clearAllMocks());

  it("enqueuePost marks the targets pending, then adds the process job without a companyId", async () => {
    await service.enqueuePost({ postId: "p", generateSummary: true, languages: ["it"] });

    expect(postTranslationRepo.ensurePending).toHaveBeenCalledWith({ postId: "p", languages: ["it"] });
    expect(queue.add).toHaveBeenCalledWith(BlogJobName.ProcessPost, {
      postId: "p",
      generateSummary: true,
      languages: ["it"],
    });
    expect(postTranslationRepo.ensurePending.mock.invocationCallOrder[0]).toBeLessThan(
      queue.add.mock.invocationCallOrder[0],
    );
  });

  it("enqueuePostLanguage adds one translate job", async () => {
    await service.enqueuePostLanguage({ postId: "p", language: "it" });

    expect(postTranslationRepo.ensurePending).toHaveBeenCalledWith({ postId: "p", languages: ["it"] });
    expect(queue.add).toHaveBeenCalledWith(BlogJobName.TranslatePost, { postId: "p", language: "it" });
  });

  it("enqueueCategory and enqueueCategoryLanguage use the category jobs", async () => {
    await service.enqueueCategory({ categoryId: "c", languages: ["it"] });
    await service.enqueueCategoryLanguage({ categoryId: "c", language: "it" });

    expect(categoryTranslationRepo.ensurePending).toHaveBeenCalledWith({ categoryId: "c", languages: ["it"] });
    expect(queue.add).toHaveBeenCalledWith(BlogJobName.ProcessCategory, { categoryId: "c", languages: ["it"] });
    expect(queue.add).toHaveBeenCalledWith(BlogJobName.TranslateCategory, { categoryId: "c", language: "it" });
  });
});
