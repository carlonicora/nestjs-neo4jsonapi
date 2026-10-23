import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { BlogCategory } from "../entities/blog-category";
import { blogCategoryMeta } from "../entities/blog-category.meta";
import { BlogCategoryTranslation } from "../entities/blog-category-translation";
import { BlogCategoryTranslationRepository } from "../repositories/blog-category-translation.repository";
import { BlogCategoryRepository } from "../repositories/blog-category.repository";
import { BlogCategoryService } from "./blog-category.service";
import { BlogQueueService } from "./blog-queue.service";

const CATEGORY_ID = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";

const categoryDto = (attributes: Record<string, any> = {}): JsonApiDTOData => ({
  id: CATEGORY_ID,
  type: blogCategoryMeta.endpoint,
  attributes: { originalLanguage: "en", name: "Game prep", ...attributes },
});

describe("BlogCategoryService", () => {
  let service: BlogCategoryService;
  let categoryRepo: Mocked<
    Pick<
      BlogCategoryRepository,
      "findById" | "createWithOriginal" | "updateShared" | "deleteWithTranslations" | "findPublicList"
    >
  >;
  let translationRepo: Mocked<
    Pick<BlogCategoryTranslationRepository, "findOriginal" | "findSlugsWithPrefix" | "updateText">
  >;
  let queue: Mocked<Pick<BlogQueueService, "enqueueCategory" | "enqueueCategoryLanguage">>;
  let jsonApiService: Mocked<Pick<JsonApiService, "buildSingle" | "buildList">>;

  beforeEach(async () => {
    categoryRepo = {
      findById: vi.fn().mockResolvedValue({ id: CATEGORY_ID, originalLanguage: "en" } as BlogCategory),
      createWithOriginal: vi.fn(),
      updateShared: vi.fn(),
      deleteWithTranslations: vi.fn(),
      findPublicList: vi.fn().mockResolvedValue([]),
    };
    translationRepo = {
      findOriginal: vi
        .fn()
        .mockResolvedValue({ id: "t", name: "Game prep", slug: "game-prep" } as BlogCategoryTranslation),
      findSlugsWithPrefix: vi.fn().mockResolvedValue([]),
      updateText: vi.fn(),
    };
    queue = { enqueueCategory: vi.fn(), enqueueCategoryLanguage: vi.fn() };
    jsonApiService = { buildSingle: vi.fn().mockResolvedValue({ data: {} }), buildList: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        BlogCategoryService,
        { provide: JsonApiService, useValue: jsonApiService },
        { provide: BlogCategoryRepository, useValue: categoryRepo },
        { provide: BlogCategoryTranslationRepository, useValue: translationRepo },
        { provide: BlogQueueService, useValue: queue },
        { provide: ClsService, useValue: { get: vi.fn() } },
        {
          provide: ConfigService,
          useValue: { get: vi.fn().mockReturnValue({ enabled: true, supportedLanguages: ["en", "it"] }) },
        },
      ],
    }).compile();

    service = module.get(BlogCategoryService);
  });

  afterEach(() => vi.clearAllMocks());

  it("createFromDTO stores the original and queues every other language", async () => {
    await service.createFromDTO({ data: categoryDto() });

    expect(categoryRepo.createWithOriginal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CATEGORY_ID,
        originalLanguage: "en",
        translation: expect.objectContaining({ name: "Game prep", slug: "game-prep" }),
      }),
    );
    expect(queue.enqueueCategory).toHaveBeenCalledWith({ categoryId: CATEGORY_ID, languages: ["it"] });
  });

  it("createFromDTO rejects a language the app does not support", async () => {
    await expect(service.createFromDTO({ data: categoryDto({ originalLanguage: "fr" }) })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("putFromDTO re-translates only when the text changed", async () => {
    await service.putFromDTO({ data: categoryDto({ image: "categories/x.png" }) });

    expect(categoryRepo.updateShared).toHaveBeenCalledWith({ id: CATEGORY_ID, image: "categories/x.png" });
    expect(queue.enqueueCategory).not.toHaveBeenCalled();
  });

  it("putFromDTO re-translates a renamed category", async () => {
    await service.putFromDTO({ data: categoryDto({ name: "Session prep" }) });

    expect(translationRepo.updateText).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t", name: "Session prep", slug: "session-prep" }),
    );
    expect(queue.enqueueCategory).toHaveBeenCalledWith({ categoryId: CATEGORY_ID, languages: ["it"] });
  });

  it("delete removes the category with its translations", async () => {
    await service.delete({ id: CATEGORY_ID });

    expect(categoryRepo.deleteWithTranslations).toHaveBeenCalledWith({ id: CATEGORY_ID });
  });

  it("delete throws NotFound for an unknown category", async () => {
    categoryRepo.findById.mockResolvedValue(null);

    await expect(service.delete({ id: CATEGORY_ID })).rejects.toThrow(NotFoundException);
    expect(categoryRepo.deleteWithTranslations).not.toHaveBeenCalled();
  });

  it("findPublicList builds the whole list with a fetch-all paginator", async () => {
    await service.findPublicList({ language: "it" });

    expect(categoryRepo.findPublicList).toHaveBeenCalledWith({ language: "it" });
    expect(jsonApiService.buildList).toHaveBeenCalledWith(expect.anything(), [], expect.any(JsonApiPaginator));
  });
});
