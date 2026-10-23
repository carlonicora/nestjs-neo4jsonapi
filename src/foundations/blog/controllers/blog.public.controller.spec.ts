import { NotFoundException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { FastifyReply } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { MODULE_ACL_METADATA } from "../../../common/decorators/module.decorator";
import { BlogCategoryService } from "../services/blog-category.service";
import { BlogPostService } from "../services/blog-post.service";
import { BlogSettingsService } from "../services/blog-settings.service";
import { BlogPublicController } from "./blog.public.controller";

describe("BlogPublicController", () => {
  let controller: BlogPublicController;
  const blogPostService: Mocked<
    Pick<BlogPostService, "findPublishedList" | "findPublishedBySlug" | "findPublishedRelated">
  > = {
    findPublishedList: vi.fn().mockResolvedValue({ data: [] }),
    findPublishedBySlug: vi.fn(),
    findPublishedRelated: vi.fn().mockResolvedValue({ data: [] }),
  };
  const blogCategoryService: Mocked<Pick<BlogCategoryService, "findPublicList">> = {
    findPublicList: vi.fn().mockResolvedValue({ data: [] }),
  };
  const blogSettingsService: Mocked<Pick<BlogSettingsService, "getSettings">> = {
    getSettings: vi.fn().mockResolvedValue({ data: {} }),
  };
  const replyMock: Mocked<Pick<FastifyReply, "send">> = { send: vi.fn() };
  const reply = replyMock as unknown as FastifyReply;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [BlogPublicController],
      providers: [
        { provide: BlogPostService, useValue: blogPostService },
        { provide: BlogCategoryService, useValue: blogCategoryService },
        { provide: BlogSettingsService, useValue: blogSettingsService },
      ],
    }).compile();
    controller = module.get(BlogPublicController);
  });

  it("has no guard and no permission section", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, BlogPublicController)).toBeUndefined();
    expect(Reflect.getMetadata(MODULE_ACL_METADATA, BlogPublicController)).toBeUndefined();
  });

  it("findPublished forwards language, category and search", async () => {
    const query = { page: { size: "12" } };

    await controller.findPublished(reply, query, "it", "game-prep", "fiume");

    expect(blogPostService.findPublishedList).toHaveBeenCalledWith({
      query,
      language: "it",
      categorySlug: "game-prep",
      search: "fiume",
    });
    expect(replyMock.send).toHaveBeenCalledWith({ data: [] });
  });

  it("findBySlug returns the service's 404 for an unpublished post", async () => {
    blogPostService.findPublishedBySlug.mockRejectedValue(new NotFoundException());

    await expect(controller.findBySlug(reply, "draft-post", "en")).rejects.toBeInstanceOf(NotFoundException);
    expect(replyMock.send).not.toHaveBeenCalled();
  });

  it("findRelated resolves by slug and language", async () => {
    await controller.findRelated(reply, "prep", "it");

    expect(blogPostService.findPublishedRelated).toHaveBeenCalledWith({ slug: "prep", language: "it" });
  });

  it("serves the categories and the settings", async () => {
    await controller.findCategories(reply, "it");
    await controller.findSettings(reply);

    expect(blogCategoryService.findPublicList).toHaveBeenCalledWith({ language: "it" });
    expect(blogSettingsService.getSettings).toHaveBeenCalled();
  });
});
