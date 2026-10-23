import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { BlogPostRepository } from "./blog-post.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";

type Neo4jServiceMock = Mocked<
  Pick<
    Neo4jService,
    "initQuery" | "readOne" | "readMany" | "readManyWithoutCount" | "writeOne" | "executeInTransaction"
  >
>;

describe("BlogPostRepository", () => {
  let repo: BlogPostRepository;
  let neo4jService: Neo4jServiceMock;
  let captured: { query: string; queryParams: Record<string, any> };

  const transactionQueries = (): { query: string; params?: any }[] =>
    neo4jService.executeInTransaction.mock.calls.flatMap(([queries]) => queries);

  beforeEach(async () => {
    captured = { query: "", queryParams: {} };

    const mockNeo4jService = {
      initQuery: vi.fn().mockImplementation(() => captured),
      readOne: vi.fn().mockResolvedValue(null),
      readMany: vi.fn().mockResolvedValue([]),
      readManyWithoutCount: vi.fn().mockResolvedValue([]),
      writeOne: vi.fn(),
      executeInTransaction: vi.fn().mockResolvedValue([]),
    } as Neo4jServiceMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogPostRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: SecurityService, useValue: { userHasAccess: vi.fn() } },
        { provide: ClsService, useValue: { get: vi.fn(), set: vi.fn(), has: vi.fn() } },
      ],
    }).compile();

    repo = module.get<BlogPostRepository>(BlogPostRepository);
    neo4jService = mockNeo4jService;
  });

  describe("find (admin list search)", () => {
    it("searches every language version through the translation full-text index", async () => {
      await repo.find({ term: "fiume", cursor: {} as any });
      expect(captured.query).toContain(`db.index.fulltext.queryNodes("blogPostTranslation_search_index"`);
      expect(captured.query).toContain("HAS_TRANSLATION");
      expect(captured.query).toContain("{CURSOR}");
      expect(captured.queryParams.term).toBeTruthy();
    });

    it("scopes every full-text hit through buildDefaultMatch and keeps the score", async () => {
      await repo.find({ term: "fiume", cursor: {} as any });
      expect(captured.query).toContain("blogPost_fulltextAccess");
      expect(captured.query).toMatch(/WITH blogPost, score\s+ORDER BY score DESC\s+\{CURSOR\}/);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findPublished", () => {
    it("serves only published posts and falls back to the original", async () => {
      await repo.findPublished({ language: "it", cursor: {} as any });

      expect(captured.query).toContain(`blogPost.status = "published"`);
      expect(captured.query).toMatch(/isOriginal/);
      expect(captured.query).toContain("{CURSOR}");
      expect(captured.queryParams.language).toBe("it");
      expect(captured.queryParams.completedStatus).toBe("completed");
      expect(neo4jService.readMany).toHaveBeenCalledWith(captured);
    });

    it("orders by publishedAt, newest first, without a term", async () => {
      await repo.findPublished({ language: "en", cursor: {} as any });

      expect(captured.query).toContain("ORDER BY blogPost.publishedAt DESC");
      expect(captured.query).not.toContain("db.index.fulltext.queryNodes");
    });

    it("with a term uses the translation full-text index and orders by score", async () => {
      await repo.findPublished({ language: "it", term: "fiume", cursor: {} as any });

      expect(captured.query).toContain(`db.index.fulltext.queryNodes("blogPostTranslation_search_index"`);
      expect(captured.query).toContain("WHERE node = t");
      expect(captured.query).toContain("ORDER BY score DESC");
      expect(captured.queryParams.term).toBe("*fiume*");
    });

    it("filters by a category slug of any language", async () => {
      await repo.findPublished({ language: "en", categorySlug: "game-prep", cursor: {} as any });

      expect(captured.query).toContain("IN_BLOG_CATEGORY");
      expect(captured.query).toContain("{slug: $categorySlug}");
      expect(captured.queryParams.categorySlug).toBe("game-prep");
    });

    it("never returns the author User node", async () => {
      await repo.findPublished({ language: "en", cursor: {} as any });

      expect(captured.query).not.toMatch(/RETURN[\s\S]*blogPost_author\b/);
      expect(captured.query).toContain("authorName");
      expect(captured.query).toContain("categoryIds");
    });

    it("keeps ORDER BY as the last clause before the cursor so the count query stays valid", async () => {
      await repo.findPublished({ language: "en", term: "x", cursor: {} as any });

      const beforeCursor = captured.query.substring(0, captured.query.indexOf("{CURSOR}"));
      expect(beforeCursor).toMatch(/ORDER\s+BY\s+[^{]+$/s);
    });
  });

  describe("findPublishedBySlug", () => {
    it("matches the slug of any language, only for published posts, and returns the body", async () => {
      await repo.findPublishedBySlug({ slug: "prep-situations", language: "it" });

      expect(captured.query).toContain(`blogPost.status = "published"`);
      expect(captured.query).toContain("{slug: $slug}");
      expect(captured.query).toMatch(/isOriginal/);
      expect(captured.query).toContain("resolvedBody");
      expect(captured.query).not.toMatch(/RETURN[\s\S]*blogPost_author\b/);
      expect(captured.queryParams).toMatchObject({ slug: "prep-situations", language: "it" });
    });

    it("returns null for a draft or unknown slug", async () => {
      neo4jService.readOne.mockResolvedValue(null);

      await expect(repo.findPublishedBySlug({ slug: "draft", language: "en" })).resolves.toBeNull();
    });
  });

  describe("findPublishedRelated", () => {
    it("returns other published posts sharing a category, capped through the cursor", async () => {
      await repo.findPublishedRelated({ postId: "p", language: "en", limit: 3 });

      expect(captured.query).toContain(`blogPost.status = "published"`);
      expect(captured.query).toContain("blogPost.id <> $postId");
      expect(captured.query).toMatch(/ORDER BY blogPost\.publishedAt DESC\s+\{CURSOR\}/);
      expect(captured.query).not.toContain("$limit");
      expect(neo4jService.initQuery).toHaveBeenCalledWith(expect.objectContaining({ cursor: { take: 3 } }));
      expect(captured.queryParams).toMatchObject({ postId: "p" });
      expect(neo4jService.readManyWithoutCount).toHaveBeenCalledWith(captured);
    });
  });

  describe("setStatus", () => {
    it("keeps the first publishedAt", async () => {
      await repo.setStatus({ id: "p", status: "published" });

      const [{ query, params }] = transactionQueries();
      expect(query).toContain("coalesce(blogPost.publishedAt, datetime())");
      expect(params).toEqual({ id: "p", status: "published" });
    });

    it("does not touch publishedAt when unpublishing", async () => {
      await repo.setStatus({ id: "p", status: "unpublished" });

      const [{ query }] = transactionQueries();
      expect(query).not.toContain("publishedAt");
    });
  });

  describe("createWithOriginal", () => {
    it("creates a draft post, its author edge, its original translation and its categories", async () => {
      await repo.createWithOriginal({
        id: "p",
        authorId: "u",
        originalLanguage: "en",
        categoryIds: ["c"],
        translation: { id: "t", title: "T", slug: "t", body: "[]", bodyText: "", readingMinutes: 1 },
      });

      const queries = transactionQueries();
      expect(queries[0].query).toContain("AUTHORED");
      expect(queries[0].params).toMatchObject({ status: "draft", originalLanguage: "en", coverImage: null });
      expect(queries[1].query).toContain("isOriginal: true");
      expect(queries[1].params).toMatchObject({ source: "original", aiStatus: "completed", slug: "t" });
      expect(queries[2].params).toEqual({ id: "p", categoryIds: ["c"] });
    });
  });

  describe("updateShared", () => {
    it("replaces the category edges with the given list", async () => {
      await repo.updateShared({ id: "p", categoryIds: ["a"] });

      const queries = transactionQueries();
      expect(queries[1].query).toContain("NOT category.id IN $categoryIds");
      expect(queries[1].query).toContain("DELETE edge");
      expect(queries[2].query).toContain("MERGE (blogPost)-[:IN_BLOG_CATEGORY]->(category)");
    });
  });

  describe("deleteWithTranslations", () => {
    it("deletes the post and its translations", async () => {
      await repo.deleteWithTranslations({ id: "p" });

      const [{ query }] = transactionQueries();
      expect(query).toContain("HAS_TRANSLATION");
      expect(query).toContain("DETACH DELETE blogPost");
    });
  });
});
