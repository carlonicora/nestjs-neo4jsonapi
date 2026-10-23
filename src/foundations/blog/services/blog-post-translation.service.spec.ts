import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { BlogPostTranslationPutDTO } from "../dtos/blog-post-translation.put.dto";
import { BlogPostTranslation } from "../entities/blog-post-translation";
import { blogPostTranslationMeta } from "../entities/blog-post-translation.meta";
import { BlogPostTranslationRepository } from "../repositories/blog-post-translation.repository";
import { BlogPostTranslationService } from "./blog-post-translation.service";
import { BlogQueueService } from "./blog-queue.service";

const TRANSLATION_ID = "0d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d";

const translationDto = (attributes: Partial<BlogPostTranslationPutDTO["data"]["attributes"]> = {}) =>
  ({
    id: TRANSLATION_ID,
    type: blogPostTranslationMeta.endpoint,
    attributes: { title: "Titolo", body: "[]", ...attributes },
  }) as BlogPostTranslationPutDTO["data"];

describe("BlogPostTranslationService", () => {
  let service: BlogPostTranslationService;
  let translationRepo: Mocked<Pick<BlogPostTranslationRepository, "findById" | "findSlugsWithPrefix" | "updateText">>;
  let queue: Mocked<Pick<BlogQueueService, "enqueuePost" | "enqueuePostLanguage">>;

  beforeEach(async () => {
    translationRepo = {
      findById: vi.fn().mockResolvedValue({
        id: TRANSLATION_ID,
        language: "it",
        isOriginal: false,
        title: "Titolo vecchio",
        slug: "titolo-vecchio",
        post: { id: "p", status: "published" },
      } as BlogPostTranslation),
      findSlugsWithPrefix: vi.fn().mockResolvedValue([]),
      updateText: vi.fn(),
    };
    queue = { enqueuePost: vi.fn(), enqueuePostLanguage: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        BlogPostTranslationService,
        {
          provide: JsonApiService,
          useValue: { buildSingle: vi.fn().mockResolvedValue({ data: {} }), buildList: vi.fn() },
        },
        { provide: BlogPostTranslationRepository, useValue: translationRepo },
        { provide: BlogQueueService, useValue: queue },
        { provide: ClsService, useValue: { get: vi.fn() } },
        { provide: BlockNoteService, useValue: { convertToPlainText: vi.fn().mockReturnValue("testo") } },
      ],
    }).compile();

    service = module.get(BlogPostTranslationService);
  });

  afterEach(() => vi.clearAllMocks());

  it("translation update marks the record manual and queues nothing", async () => {
    await service.updateTranslation({ data: translationDto({ title: "Titolo" }) });

    expect(translationRepo.updateText).toHaveBeenCalledWith(
      expect.objectContaining({ id: TRANSLATION_ID, title: "Titolo", source: "manual" }),
    );
    expect(queue.enqueuePostLanguage).not.toHaveBeenCalled();
    expect(queue.enqueuePost).not.toHaveBeenCalled();
  });

  it("keeps the slug of a published post when the title changes", async () => {
    await service.updateTranslation({ data: translationDto({ title: "Titolo nuovo" }) });

    expect(translationRepo.updateText).toHaveBeenCalledWith(expect.objectContaining({ slug: "titolo-vecchio" }));
  });

  it("applies an explicit slug, unique in the translation's language", async () => {
    translationRepo.findSlugsWithPrefix.mockResolvedValue(["mio-slug"]);

    await service.updateTranslation({ data: translationDto({ slug: "Mio slug" }) });

    expect(translationRepo.findSlugsWithPrefix).toHaveBeenCalledWith({
      language: "it",
      prefix: "mio-slug",
      excludeTranslationId: TRANSLATION_ID,
    });
    expect(translationRepo.updateText).toHaveBeenCalledWith(expect.objectContaining({ slug: "mio-slug-2" }));
  });

  it("translation update refuses the original", async () => {
    translationRepo.findById.mockResolvedValue({
      id: TRANSLATION_ID,
      language: "en",
      isOriginal: true,
    } as BlogPostTranslation);

    await expect(service.updateTranslation({ data: translationDto() })).rejects.toThrow(BadRequestException);
    expect(translationRepo.updateText).not.toHaveBeenCalled();
  });

  it("translation update throws NotFound for an unknown id", async () => {
    translationRepo.findById.mockResolvedValue(null);

    await expect(service.updateTranslation({ data: translationDto() })).rejects.toThrow(NotFoundException);
  });

  it("retranslate queues that one language from the current original", async () => {
    await service.retranslate({ id: TRANSLATION_ID });

    expect(queue.enqueuePostLanguage).toHaveBeenCalledWith({ postId: "p", language: "it" });
  });

  it("retranslate refuses the original", async () => {
    translationRepo.findById.mockResolvedValue({
      id: TRANSLATION_ID,
      language: "en",
      isOriginal: true,
    } as BlogPostTranslation);

    await expect(service.retranslate({ id: TRANSLATION_ID })).rejects.toThrow(BadRequestException);
    expect(queue.enqueuePostLanguage).not.toHaveBeenCalled();
  });
});
