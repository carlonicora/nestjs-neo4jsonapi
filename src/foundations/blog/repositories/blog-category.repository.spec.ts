import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { BlogCategoryRepository } from "./blog-category.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";

type Neo4jServiceMock = Mocked<
  Pick<Neo4jService, "initQuery" | "readOne" | "readMany" | "writeOne" | "executeInTransaction">
>;

describe("BlogCategoryRepository", () => {
  let repo: BlogCategoryRepository;
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
        BlogCategoryRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: SecurityService, useValue: { userHasAccess: vi.fn() } },
        { provide: ClsService, useValue: { get: vi.fn(), set: vi.fn(), has: vi.fn() } },
      ],
    }).compile();

    repo = module.get<BlogCategoryRepository>(BlogCategoryRepository);
    neo4jService = mockNeo4jService;
  });

  describe("find (admin list search)", () => {
    it("searches every language version through the translation full-text index", async () => {
      await repo.find({ term: "fiume", cursor: {} as any });
      expect(captured.query).toContain(`db.index.fulltext.queryNodes("blogCategoryTranslation_search_index"`);
      expect(captured.query).toContain("HAS_TRANSLATION");
      expect(captured.query).toContain("{CURSOR}");
      expect(captured.queryParams.term).toBeTruthy();
    });

    it("scopes every full-text hit through buildDefaultMatch and keeps the score", async () => {
      await repo.find({ term: "fiume", cursor: {} as any });
      expect(captured.query).toContain("blogCategory_fulltextAccess");
      expect(captured.query).toMatch(/WITH blogCategory, score\s+ORDER BY score DESC\s+\{CURSOR\}/);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("findPublicList resolves the visitor's language and falls back to the original", async () => {
    await repo.findPublicList({ language: "it" });

    expect(captured.query).toMatch(/isOriginal/);
    expect(captured.query).toContain("localised.aiStatus = $completedStatus");
    expect(captured.query).toContain("t.name AS resolvedName");
    expect(captured.query).toContain("t.slug AS resolvedSlug");
    expect(captured.queryParams).toMatchObject({ language: "it", completedStatus: "completed" });
    expect(neo4jService.readMany).toHaveBeenCalledWith(captured);
  });

  it("createWithOriginal creates the category and its original translation", async () => {
    await repo.createWithOriginal({
      id: "c",
      originalLanguage: "en",
      translation: { id: "t", name: "Game prep", slug: "game-prep" },
    });

    const [{ query, params }] = transactionQueries();
    expect(query).toContain("isOriginal: true");
    expect(query).toContain("HAS_TRANSLATION");
    expect(params).toMatchObject({
      id: "c",
      image: null,
      source: "original",
      aiStatus: "completed",
      slug: "game-prep",
    });
  });

  it("updateShared sets the image", async () => {
    await repo.updateShared({ id: "c", image: "key" });

    const [{ query, params }] = transactionQueries();
    expect(query).toContain("blogCategory.image = $image");
    expect(params).toEqual({ id: "c", image: "key" });
  });

  it("deleteWithTranslations deletes the category and its translations", async () => {
    await repo.deleteWithTranslations({ id: "c" });

    const [{ query }] = transactionQueries();
    expect(query).toContain("DETACH DELETE blogCategory");
    expect(query).toContain("FOREACH (item IN translations | DETACH DELETE item)");
  });
});
