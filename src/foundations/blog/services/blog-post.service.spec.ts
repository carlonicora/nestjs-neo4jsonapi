import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { ConfigI18nInterface } from "../../../config/interfaces/config.i18n.interface";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { BlogPost } from "../entities/blog-post";
import { blogPostMeta } from "../entities/blog-post.meta";
import { BlogPostTranslation } from "../entities/blog-post-translation";
import { BlogPostTranslationRepository } from "../repositories/blog-post-translation.repository";
import { BlogPostRepository } from "../repositories/blog-post.repository";
import { BlogPostService } from "./blog-post.service";
import { BlogQueueService } from "./blog-queue.service";

const POST_ID = "5b7f8e0a-1c2d-4e3f-9a8b-7c6d5e4f3a2b";
const BODY = '[{"type":"paragraph","content":[{"type":"text","text":"Hello world"}]}]';

const postDto = (
  attributes: Record<string, any> = {},
  relationships?: JsonApiDTOData["relationships"],
): JsonApiDTOData => ({
  id: POST_ID,
  type: blogPostMeta.endpoint,
  attributes: { originalLanguage: "en", title: "Prep situations", body: BODY, ...attributes },
  relationships,
});

/** A stored post: only the fields the service reads. */
const storedPost = (overrides: Partial<BlogPost> = {}): BlogPost =>
  ({ id: POST_ID, status: "draft", originalLanguage: "en", ...overrides }) as BlogPost;

describe("BlogPostService", () => {
  let service: BlogPostService;
  let postRepo: Mocked<
    Pick<
      BlogPostRepository,
      | "findById"
      | "createWithOriginal"
      | "updateShared"
      | "setStatus"
      | "deleteWithTranslations"
      | "findPublished"
      | "findPublishedBySlug"
      | "findPublishedRelated"
    >
  >;
  let translationRepo: Mocked<
    Pick<BlogPostTranslationRepository, "findOriginal" | "findSlugsWithPrefix" | "updateText">
  >;
  let queue: Mocked<Pick<BlogQueueService, "enqueuePost" | "enqueuePostLanguage">>;
  let config: { i18n: ConfigI18nInterface };
  let jsonApiService: Mocked<Pick<JsonApiService, "buildSingle" | "buildList">>;

  beforeEach(async () => {
    config = { i18n: { enabled: true, supportedLanguages: ["en", "it"] } };
    postRepo = {
      findById: vi.fn().mockResolvedValue(storedPost()),
      createWithOriginal: vi.fn(),
      updateShared: vi.fn(),
      setStatus: vi.fn(),
      deleteWithTranslations: vi.fn(),
      findPublished: vi.fn().mockResolvedValue([]),
      findPublishedBySlug: vi.fn(),
      findPublishedRelated: vi.fn().mockResolvedValue([]),
    };
    translationRepo = {
      findOriginal: vi.fn(),
      findSlugsWithPrefix: vi.fn().mockResolvedValue([]),
      updateText: vi.fn(),
    };
    queue = { enqueuePost: vi.fn(), enqueuePostLanguage: vi.fn() };
    jsonApiService = {
      buildSingle: vi.fn().mockResolvedValue({ data: {} }),
      buildList: vi.fn().mockResolvedValue({ data: [] }),
    };

    const module = await Test.createTestingModule({
      providers: [
        BlogPostService,
        { provide: JsonApiService, useValue: jsonApiService },
        { provide: BlogPostRepository, useValue: postRepo },
        { provide: BlogPostTranslationRepository, useValue: translationRepo },
        { provide: BlogQueueService, useValue: queue },
        { provide: ClsService, useValue: { get: vi.fn((key: string) => (key === "userId" ? "user-1" : undefined)) } },
        { provide: BlockNoteService, useValue: { convertToPlainText: vi.fn().mockReturnValue("Hello world") } },
        { provide: ConfigService, useValue: { get: vi.fn((key: string) => config[key as keyof typeof config]) } },
      ],
    }).compile();

    service = module.get(BlogPostService);
  });

  afterEach(() => vi.clearAllMocks());

  describe("createFromDTO", () => {
    it("stores a draft with the original and queues summary + every other language", async () => {
      await service.createFromDTO({ data: postDto() });

      expect(postRepo.createWithOriginal).toHaveBeenCalledWith(
        expect.objectContaining({
          id: POST_ID,
          authorId: "user-1",
          originalLanguage: "en",
          translation: expect.objectContaining({ slug: "prep-situations", bodyText: "Hello world", readingMinutes: 1 }),
        }),
      );
      expect(queue.enqueuePost).toHaveBeenCalledWith({ postId: POST_ID, generateSummary: true, languages: ["it"] });
    });

    it("rejects a language the app does not support", async () => {
      await expect(service.createFromDTO({ data: postDto({ originalLanguage: "fr" }) })).rejects.toThrow(
        BadRequestException,
      );
      expect(postRepo.createWithOriginal).not.toHaveBeenCalled();
    });

    it("does not generate a summary the admin wrote", async () => {
      await service.createFromDTO({ data: postDto({ summary: "Written by hand" }) });

      expect(queue.enqueuePost).toHaveBeenCalledWith(expect.objectContaining({ generateSummary: false }));
    });

    it("suffixes a slug already taken in the same language", async () => {
      translationRepo.findSlugsWithPrefix.mockResolvedValue(["prep-situations"]);

      await service.createFromDTO({ data: postDto() });

      expect(translationRepo.findSlugsWithPrefix).toHaveBeenCalledWith(
        expect.objectContaining({ language: "en", prefix: "prep-situations" }),
      );
      expect(postRepo.createWithOriginal).toHaveBeenCalledWith(
        expect.objectContaining({ translation: expect.objectContaining({ slug: "prep-situations-2" }) }),
      );
    });

    it("passes the category ids from the relationship", async () => {
      await service.createFromDTO({
        data: postDto({}, { categories: { data: [{ id: "c1", type: "blog-categories" }] } }),
      });

      expect(postRepo.createWithOriginal).toHaveBeenCalledWith(expect.objectContaining({ categoryIds: ["c1"] }));
    });

    it("rejects a body that is not BlockNote JSON", async () => {
      await expect(service.createFromDTO({ data: postDto({ body: "not json" }) })).rejects.toThrow(BadRequestException);
    });
  });

  describe("findPublishedList", () => {
    it("caps the page size an anonymous visitor can ask for", async () => {
      await service.findPublishedList({ query: { "page[size]": "100000" }, language: "en" });
      expect(postRepo.findPublished.mock.calls[0][0].cursor.take).toBe(121);
    });
  });

  describe("putFromDTO", () => {
    const original = {
      id: "t",
      slug: "old-title",
      title: "Old title",
      body: BODY,
      summary: "s",
    } as BlogPostTranslation;

    it("keeps slugs of a published post when the title changes", async () => {
      postRepo.findById.mockResolvedValue(storedPost({ status: "published" }));
      translationRepo.findOriginal.mockResolvedValue(original);

      await service.putFromDTO({ data: postDto({ title: "New title", summary: "s" }) });

      expect(translationRepo.updateText).toHaveBeenCalledWith(
        expect.objectContaining({ id: "t", title: "New title", slug: "old-title" }),
      );
    });

    it("regenerates the slug of a draft when the title changes", async () => {
      translationRepo.findOriginal.mockResolvedValue(original);

      await service.putFromDTO({ data: postDto({ title: "New title", summary: "s" }) });

      expect(translationRepo.updateText).toHaveBeenCalledWith(expect.objectContaining({ slug: "new-title" }));
      expect(translationRepo.findSlugsWithPrefix).toHaveBeenCalledWith(
        expect.objectContaining({ excludeTranslationId: "t" }),
      );
    });

    it("always applies an explicit slug, even on a published post", async () => {
      postRepo.findById.mockResolvedValue(storedPost({ status: "published" }));
      translationRepo.findOriginal.mockResolvedValue(original);

      await service.putFromDTO({ data: postDto({ title: "Old title", summary: "s", slug: "Hand Picked" }) });

      expect(translationRepo.updateText).toHaveBeenCalledWith(expect.objectContaining({ slug: "hand-picked" }));
    });

    it("re-translates only when original text changed", async () => {
      translationRepo.findOriginal.mockResolvedValue(original);

      await service.putFromDTO({ data: postDto({ title: "Old title", summary: "s", coverImage: "covers/new.png" }) });

      expect(postRepo.updateShared).toHaveBeenCalledWith(expect.objectContaining({ coverImage: "covers/new.png" }));
      expect(queue.enqueuePost).not.toHaveBeenCalled();
    });

    it("regenerates the summary when the body changed and the summary did not", async () => {
      translationRepo.findOriginal.mockResolvedValue(original);

      await service.putFromDTO({ data: postDto({ title: "Old title", summary: "s", body: "[]" }) });

      expect(queue.enqueuePost).toHaveBeenCalledWith({ postId: POST_ID, generateSummary: true, languages: ["it"] });
    });

    it("keeps a summary the admin edited on the same save", async () => {
      translationRepo.findOriginal.mockResolvedValue(original);

      await service.putFromDTO({ data: postDto({ title: "Old title", summary: "New summary", body: "[]" }) });

      expect(queue.enqueuePost).toHaveBeenCalledWith(expect.objectContaining({ generateSummary: false }));
    });

    it("throws NotFound for an unknown post", async () => {
      postRepo.findById.mockResolvedValue(null);

      await expect(service.putFromDTO({ data: postDto() })).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("deletes the post with its translations", async () => {
      await service.delete({ id: POST_ID });

      expect(postRepo.deleteWithTranslations).toHaveBeenCalledWith({ id: POST_ID });
    });

    it("throws NotFound for an unknown post", async () => {
      postRepo.findById.mockResolvedValue(null);

      await expect(service.delete({ id: POST_ID })).rejects.toThrow(NotFoundException);
      expect(postRepo.deleteWithTranslations).not.toHaveBeenCalled();
    });
  });

  describe("publishing", () => {
    it("publish sets the status to published", async () => {
      await service.publish({ id: POST_ID });

      expect(postRepo.setStatus).toHaveBeenCalledWith({ id: POST_ID, status: "published" });
    });

    it("unpublish refuses a post that is not published", async () => {
      await expect(service.unpublish({ id: POST_ID })).rejects.toThrow(BadRequestException);
      expect(postRepo.setStatus).not.toHaveBeenCalled();
    });

    it("unpublish sets a published post to unpublished", async () => {
      postRepo.findById.mockResolvedValue(storedPost({ status: "published" }));

      await service.unpublish({ id: POST_ID });

      expect(postRepo.setStatus).toHaveBeenCalledWith({ id: POST_ID, status: "unpublished" });
    });
  });

  describe("public reads", () => {
    it("findPublishedList passes language, category and search to the repository", async () => {
      await service.findPublishedList({ query: {}, language: "it", categorySlug: "prep", search: "fiume" });

      expect(postRepo.findPublished).toHaveBeenCalledWith(
        expect.objectContaining({ language: "it", categorySlug: "prep", term: "fiume" }),
      );
      expect(jsonApiService.buildList).toHaveBeenCalled();
    });

    it("findPublishedBySlug throws NotFound for an unknown or unpublished slug", async () => {
      postRepo.findPublishedBySlug.mockResolvedValue(null);

      await expect(service.findPublishedBySlug({ slug: "draft-post", language: "en" })).rejects.toThrow(
        NotFoundException,
      );
    });

    it("findPublishedRelated asks for at most 3 posts", async () => {
      postRepo.findPublishedBySlug.mockResolvedValue(storedPost());

      await service.findPublishedRelated({ slug: "prep", language: "en" });

      expect(postRepo.findPublishedRelated).toHaveBeenCalledWith({ postId: POST_ID, language: "en", limit: 3 });
    });
  });
});
