import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { FeatureRepository } from "../feature.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { Feature, FeatureDescriptor } from "../../entities/feature";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  featureId1: "660e8400-e29b-41d4-a716-446655440001",
  featureId2: "770e8400-e29b-41d4-a716-446655440002",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  read: vi.fn().mockResolvedValue({ records: [] }),
  initQuery: vi.fn(),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn().mockResolvedValue(true),
});

const createMockClsService = () => ({
  get: vi.fn().mockReturnValue(undefined),
  set: vi.fn(),
});

describe("FeatureRepository", () => {
  let repository: FeatureRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  let clsService: ReturnType<typeof createMockClsService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {} as Record<string, any>,
  });

  const MOCK_FEATURE: Feature = {
    id: TEST_IDS.featureId1,
    name: "Test Feature",
    isCore: true,
    module: [],
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as Feature;

  const MOCK_FEATURE_2: Feature = {
    id: TEST_IDS.featureId2,
    name: "Another Feature",
    isCore: false,
    module: [],
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as Feature;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    securityService = createMockSecurityService();
    clsService = createMockClsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: SecurityService, useValue: securityService },
        { provide: ClsService, useValue: clsService },
      ],
    }).compile();

    repository = module.get<FeatureRepository>(FeatureRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: "CREATE CONSTRAINT feature_id IF NOT EXISTS FOR (feature:Feature) REQUIRE feature.id IS UNIQUE",
      });
    });

    it("should create the fulltext index derived from the descriptor string fields", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      const indexCall = neo4jService.writeOne.mock.calls.find((call: any[]) =>
        call[0]?.query?.includes("CREATE FULLTEXT INDEX"),
      );

      expect(indexCall).toBeDefined();
      expect(indexCall![0].query).toContain("feature_search_index");
      expect(indexCall![0].query).toContain("n.`name`");
    });

    it("should handle errors during constraint creation", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findByCompany", () => {
    it("should find features by company ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_FEATURE, MOCK_FEATURE_2]);

      const result = await repository.findByCompany({ companyId: TEST_IDS.companyId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: FeatureDescriptor.model });
      expect(mockQuery.queryParams.companyId).toBe(TEST_IDS.companyId);
      expect(mockQuery.query).toContain("Company {id: $companyId}");
      expect(mockQuery.query).toContain(":HAS_FEATURE");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_FEATURE, MOCK_FEATURE_2]);
    });

    it("should return empty array when company has no features", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByCompany({ companyId: "nonexistent-company" });

      expect(result).toEqual([]);
    });

    it("should handle errors from neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockRejectedValue(new Error("Database error"));

      await expect(repository.findByCompany({ companyId: TEST_IDS.companyId })).rejects.toThrow("Database error");
    });
  });

  describe("findByName", () => {
    it("should look the feature up case-insensitively by exact name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_FEATURE);

      const result = await repository.findByName({ name: "test feature" });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: FeatureDescriptor.model });
      expect(mockQuery.queryParams.name).toBe("test feature");
      expect(mockQuery.query).toContain("MATCH (feature:Feature)");
      expect(mockQuery.query).toContain("toLower(");
      expect(mockQuery.query).toContain("$name");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(neo4jService.readMany).not.toHaveBeenCalled();
      expect(result).toEqual(MOCK_FEATURE);
    });

    it("should include the module relationship in the return statement", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_FEATURE);

      await repository.findByName({ name: "Test Feature" });

      expect(mockQuery.query).toContain("feature_module:Module");
      expect(mockQuery.query).toContain(":IN_FEATURE");
      expect(mockQuery.query).toContain("RETURN feature, feature_module");
    });

    it("should return whatever readOne returns when no feature matches", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(undefined);

      const result = await repository.findByName({ name: "nonexistent" });

      expect(result).toBeUndefined();
    });

    it("should handle errors from neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockRejectedValue(new Error("Query failed"));

      await expect(repository.findByName({ name: "Test Feature" })).rejects.toThrow("Query failed");
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values for companyId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findByCompany({ companyId: exactId });

      expect(mockQuery.queryParams.companyId).toBe(exactId);
    });

    it("should pass special characters in the name through as a query parameter", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(undefined);

      const specialName = "Test with 'quotes' and \"double quotes\"";
      await repository.findByName({ name: specialName });

      expect(mockQuery.queryParams.name).toBe(specialName);
      expect(mockQuery.query).not.toContain(specialName);
    });
  });
});
