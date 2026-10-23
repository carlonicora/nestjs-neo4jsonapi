import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { BlogSettingsRepository } from "./blog-settings.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { BLOG_SETTINGS_ID } from "../blog.constants";

type Neo4jServiceMock = Mocked<
  Pick<Neo4jService, "initQuery" | "readOne" | "readMany" | "writeOne" | "executeInTransaction">
>;

describe("BlogSettingsRepository", () => {
  let repo: BlogSettingsRepository;
  let neo4jService: Neo4jServiceMock;
  let captured: { query: string; queryParams: Record<string, any> };

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
        BlogSettingsRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: SecurityService, useValue: { userHasAccess: vi.fn() } },
        { provide: ClsService, useValue: { get: vi.fn(), set: vi.fn(), has: vi.fn() } },
      ],
    }).compile();

    repo = module.get<BlogSettingsRepository>(BlogSettingsRepository);
    neo4jService = mockNeo4jService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("findSettings reads the node with the fixed id", async () => {
    const result = await repo.findSettings();

    expect(captured.query).toContain("{id: $searchValue}");
    expect(captured.queryParams.searchValue).toBe(BLOG_SETTINGS_ID);
    expect(result).toBeNull();
  });

  it("upsert merges on BLOG_SETTINGS_ID", async () => {
    await repo.upsert({ listLayout: "rail" });

    const [[queries]] = neo4jService.executeInTransaction.mock.calls;
    expect(queries[0].query).toContain("MERGE (blogSettings:BlogSettings {id: $id})");
    expect(queries[0].params).toEqual({ id: BLOG_SETTINGS_ID, listLayout: "rail" });
  });
});
