import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { BlogPostTranslationRepository } from "./blog-post-translation.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AiStatus } from "../../../common/enums/ai.status";

type Neo4jServiceMock = Mocked<
  Pick<Neo4jService, "initQuery" | "readOne" | "readMany" | "writeOne" | "executeInTransaction">
>;

describe("BlogPostTranslationRepository", () => {
  let repo: BlogPostTranslationRepository;
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
      writeOne: vi.fn(),
      executeInTransaction: vi.fn().mockResolvedValue([]),
    } as Neo4jServiceMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogPostTranslationRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: SecurityService, useValue: { userHasAccess: vi.fn() } },
        { provide: ClsService, useValue: { get: vi.fn(), set: vi.fn(), has: vi.fn() } },
      ],
    }).compile();

    repo = module.get<BlogPostTranslationRepository>(BlogPostTranslationRepository);
    neo4jService = mockNeo4jService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findSlugsWithPrefix", () => {
    it("filters by language and prefix and returns the slugs", async () => {
      neo4jService.readMany.mockResolvedValue([{ slug: "prep" }, { slug: "prep-2" }] as any);

      const slugs = await repo.findSlugsWithPrefix({ language: "it", prefix: "prep" });

      expect(captured.query).toContain("blogPostTranslation.language = $language");
      expect(captured.query).toContain("STARTS WITH $prefix");
      expect(captured.queryParams).toMatchObject({ language: "it", prefix: "prep", excludeTranslationId: null });
      expect(slugs).toEqual(["prep", "prep-2"]);
    });

    it("leaves out the translation being re-slugged", async () => {
      await repo.findSlugsWithPrefix({ language: "en", prefix: "prep", excludeTranslationId: "t" });

      expect(captured.query).toContain("blogPostTranslation.id <> $excludeTranslationId");
      expect(captured.queryParams.excludeTranslationId).toBe("t");
    });
  });

  describe("findOriginal / findByPostAndLanguage", () => {
    it("finds the original of a post", async () => {
      await repo.findOriginal({ postId: "p" });

      expect(captured.query).toContain("blogPostTranslation.isOriginal = true");
      expect(captured.queryParams.postId).toBe("p");
      expect(neo4jService.readOne).toHaveBeenCalledWith(captured);
    });

    it("finds a post's translation by language", async () => {
      await repo.findByPostAndLanguage({ postId: "p", language: "it" });

      expect(captured.query).toContain("blogPostTranslation.language = $language");
      expect(captured.queryParams).toMatchObject({ postId: "p", language: "it" });
    });
  });

  describe("ensurePending", () => {
    it("merges one pending placeholder per non-original language", async () => {
      await repo.ensurePending({ postId: "p", languages: ["it", "de"] });

      const [{ query, params }] = transactionQueries();
      expect(query).toContain(
        "MERGE (post)-[:HAS_TRANSLATION]->(blogPostTranslation:BlogPostTranslation {language: language})",
      );
      expect(query).toContain("language <> post.originalLanguage");
      expect(params).toMatchObject({ postId: "p", languages: ["it", "de"], aiStatus: AiStatus.Pending });
    });

    it("does nothing for no languages", async () => {
      await repo.ensurePending({ postId: "p", languages: [] });

      expect(neo4jService.executeInTransaction).not.toHaveBeenCalled();
    });
  });

  describe("setAiStatus", () => {
    it("never touches the original", async () => {
      await repo.setAiStatus({ postId: "p", languages: ["it"], aiStatus: AiStatus.Failed });

      const [{ query, params }] = transactionQueries();
      expect(query).toContain("blogPostTranslation.isOriginal = false");
      expect(params).toEqual({ postId: "p", languages: ["it"], aiStatus: AiStatus.Failed });
    });
  });

  describe("updateText", () => {
    it("marks a manual edit completed and bumps the post's updatedAt", async () => {
      await repo.updateText({
        id: "t",
        title: "Titolo",
        slug: "titolo",
        body: "[]",
        bodyText: "",
        readingMinutes: 1,
        source: "manual",
      });

      const [{ query, params }] = transactionQueries();
      expect(query).toContain("SET blogPostTranslation.source = $source");
      expect(query).toContain("SET blogPostTranslation.aiStatus = $completedStatus");
      expect(query).toContain("SET item.updatedAt = datetime()");
      expect(params).toMatchObject({ id: "t", source: "manual", summary: null, coverImageAlt: null });
    });

    it("keeps source and status when no source is given", async () => {
      await repo.updateText({ id: "t", title: "T", slug: "t", body: "[]", bodyText: "", readingMinutes: 1 });

      const [{ query }] = transactionQueries();
      expect(query).not.toContain("$source");
      expect(query).not.toContain("$completedStatus");
    });
  });

  describe("writeAiTranslation", () => {
    it("upserts an AI translation with translatedAt as a datetime", async () => {
      await repo.writeAiTranslation({
        postId: "p",
        language: "it",
        title: "Titolo",
        slug: "titolo",
        body: "[]",
        bodyText: "",
        readingMinutes: 1,
      });

      const [{ query, params }] = transactionQueries();
      expect(query).toContain("post.originalLanguage <> $language");
      expect(query).toContain("translatedAt = datetime()");
      expect(params).toMatchObject({ source: "ai", aiStatus: AiStatus.Completed, language: "it", slug: "titolo" });
    });
  });
});
