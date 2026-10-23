import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { BlogCategoryTranslationRepository } from "./blog-category-translation.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AiStatus } from "../../../common/enums/ai.status";

type Neo4jServiceMock = Mocked<
  Pick<Neo4jService, "initQuery" | "readOne" | "readMany" | "writeOne" | "executeInTransaction">
>;

describe("BlogCategoryTranslationRepository", () => {
  let repo: BlogCategoryTranslationRepository;
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
        BlogCategoryTranslationRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: SecurityService, useValue: { userHasAccess: vi.fn() } },
        { provide: ClsService, useValue: { get: vi.fn(), set: vi.fn(), has: vi.fn() } },
      ],
    }).compile();

    repo = module.get<BlogCategoryTranslationRepository>(BlogCategoryTranslationRepository);
    neo4jService = mockNeo4jService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("findSlugsWithPrefix filters by language", async () => {
    neo4jService.readMany.mockResolvedValue([{ slug: "game-prep" }] as any);

    const slugs = await repo.findSlugsWithPrefix({ language: "it", prefix: "game-prep" });

    expect(captured.query).toContain("blogCategoryTranslation.language = $language");
    expect(captured.query).toContain("STARTS WITH $prefix");
    expect(captured.queryParams).toMatchObject({ language: "it", prefix: "game-prep" });
    expect(slugs).toEqual(["game-prep"]);
  });

  it("findOriginal finds the original of a category", async () => {
    await repo.findOriginal({ categoryId: "c" });

    expect(captured.query).toContain("blogCategoryTranslation.isOriginal = true");
    expect(captured.queryParams.categoryId).toBe("c");
  });

  it("findByCategoryAndLanguage filters by language", async () => {
    await repo.findByCategoryAndLanguage({ categoryId: "c", language: "it" });

    expect(captured.query).toContain("blogCategoryTranslation.language = $language");
    expect(captured.queryParams).toMatchObject({ categoryId: "c", language: "it" });
  });

  it("ensurePending merges pending placeholders, skipping the original language", async () => {
    await repo.ensurePending({ categoryId: "c", languages: ["it"] });

    const [{ query, params }] = transactionQueries();
    expect(query).toContain("language <> category.originalLanguage");
    expect(params).toMatchObject({ categoryId: "c", languages: ["it"], aiStatus: AiStatus.Pending });
  });

  it("setAiStatus never touches the original", async () => {
    await repo.setAiStatus({ categoryId: "c", languages: ["it"], aiStatus: AiStatus.Failed });

    const [{ query, params }] = transactionQueries();
    expect(query).toContain("blogCategoryTranslation.isOriginal = false");
    expect(params).toEqual({ categoryId: "c", languages: ["it"], aiStatus: AiStatus.Failed });
  });

  it("updateText records a manual edit as completed", async () => {
    await repo.updateText({ id: "t", name: "Preparazione", slug: "preparazione", source: "manual" });

    const [{ query, params }] = transactionQueries();
    expect(query).toContain("SET blogCategoryTranslation.source = $source");
    expect(query).toContain("SET blogCategoryTranslation.aiStatus = $completedStatus");
    expect(params).toMatchObject({ id: "t", source: "manual", description: null });
  });

  it("writeAiTranslation upserts an AI translation with translatedAt as a datetime", async () => {
    await repo.writeAiTranslation({ categoryId: "c", language: "it", name: "Preparazione", slug: "preparazione" });

    const [{ query, params }] = transactionQueries();
    expect(query).toContain("category.originalLanguage <> $language");
    expect(query).toContain("translatedAt = datetime()");
    expect(params).toMatchObject({ source: "ai", aiStatus: AiStatus.Completed, language: "it" });
  });
});
