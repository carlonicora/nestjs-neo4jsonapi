import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { BlogCategoryTranslationPutDTO } from "../dtos/blog-category-translation.put.dto";
import { BlogCategoryTranslation } from "../entities/blog-category-translation";
import { blogCategoryTranslationMeta } from "../entities/blog-category-translation.meta";
import { BlogCategoryTranslationRepository } from "../repositories/blog-category-translation.repository";
import { BlogCategoryTranslationService } from "./blog-category-translation.service";
import { BlogQueueService } from "./blog-queue.service";

const TRANSLATION_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

describe("BlogCategoryTranslationService", () => {
  let service: BlogCategoryTranslationService;
  let translationRepo: Mocked<
    Pick<BlogCategoryTranslationRepository, "findById" | "findSlugsWithPrefix" | "updateText">
  >;
  let queue: Mocked<Pick<BlogQueueService, "enqueueCategoryLanguage">>;

  beforeEach(async () => {
    translationRepo = {
      findById: vi.fn().mockResolvedValue({
        id: TRANSLATION_ID,
        language: "it",
        isOriginal: false,
        name: "Preparazione",
        slug: "preparazione",
        category: { id: "c" },
      } as BlogCategoryTranslation),
      findSlugsWithPrefix: vi.fn().mockResolvedValue([]),
      updateText: vi.fn(),
    };
    queue = { enqueueCategoryLanguage: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        BlogCategoryTranslationService,
        { provide: JsonApiService, useValue: { buildSingle: vi.fn().mockResolvedValue({ data: {} }) } },
        { provide: BlogCategoryTranslationRepository, useValue: translationRepo },
        { provide: BlogQueueService, useValue: queue },
        { provide: ClsService, useValue: { get: vi.fn() } },
      ],
    }).compile();

    service = module.get(BlogCategoryTranslationService);
  });

  afterEach(() => vi.clearAllMocks());

  it("marks a hand edit manual and queues nothing", async () => {
    await service.updateTranslation({
      data: {
        id: TRANSLATION_ID,
        type: blogCategoryTranslationMeta.endpoint,
        attributes: { name: "Preparazione" },
      } as BlogCategoryTranslationPutDTO["data"],
    });

    expect(translationRepo.updateText).toHaveBeenCalledWith(
      expect.objectContaining({ id: TRANSLATION_ID, slug: "preparazione", source: "manual" }),
    );
    expect(queue.enqueueCategoryLanguage).not.toHaveBeenCalled();
  });

  it("refuses the original", async () => {
    translationRepo.findById.mockResolvedValue({
      id: TRANSLATION_ID,
      language: "en",
      isOriginal: true,
    } as BlogCategoryTranslation);

    await expect(
      service.updateTranslation({
        data: {
          id: TRANSLATION_ID,
          type: blogCategoryTranslationMeta.endpoint,
          attributes: { name: "x" },
        } as BlogCategoryTranslationPutDTO["data"],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("retranslate queues that one language", async () => {
    await service.retranslate({ id: TRANSLATION_ID });

    expect(queue.enqueueCategoryLanguage).toHaveBeenCalledWith({ categoryId: "c", language: "it" });
  });
});
