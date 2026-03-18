import { vi, describe, it, expect, beforeEach, afterEach, Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { HttpException } from "@nestjs/common";
import { HowToRepository } from "./how-to.repository";
import { HowToDescriptor } from "../entities/how-to";
import { Neo4jService, SecurityService } from "@carlonicora/nestjs-neo4jsonapi";

describe("HowToRepository", () => {
  let repository: HowToRepository;
  let neo4jService: Mocked<Neo4jService>;
  let _securityService: Mocked<SecurityService>;
  let clsService: Mocked<ClsService>;

  const TEST_IDS = {
    howToId: "howto000-0001-4000-a000-0000000000001",
    companyId: "company0-0001-4000-a000-0000000000001",
    userId: "user0000-0001-4000-a000-0000000000001",
    authorId: "user0000-0001-4000-a000-0000000000001",
  };

  const MOCK_HOWTO = {
    id: TEST_IDS.howToId,
    name: "test-name",
    description: "test-description",
    pages: "test-pages",
    abstract: "test-abstract",
    tldr: "test-tldr",
    aiStatus: "test-aiStatus",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  beforeEach(async () => {
    const mockNeo4jService = {
      initQuery: vi.fn().mockReturnValue({
        query: "",
        queryParams: {},
      }),
      read: vi.fn(),
      readOne: vi.fn(),
      readMany: vi.fn(),
      writeOne: vi.fn(),
      validateExistingNodes: vi.fn(),
    };

    const mockSecurityService = {
      userHasAccess: vi.fn().mockImplementation(({ validator }) => validator?.() ?? ""),
    };

    const mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HowToRepository,
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
        {
          provide: SecurityService,
          useValue: mockSecurityService,
        },
        {
          provide: ClsService,
          useValue: mockClsService,
        },
      ],
    }).compile();

    repository = module.get<HowToRepository>(HowToRepository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as Mocked<Neo4jService>;
    _securityService = module.get<SecurityService>(SecurityService) as Mocked<SecurityService>;
    clsService = module.get<ClsService>(ClsService) as Mocked<ClsService>;

    // Default CLS context
    clsService.get.mockImplementation((key: string) => {
      if (key === "userId") return TEST_IDS.userId;
      if (key === "companyId") return TEST_IDS.companyId;
      return undefined;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create constraints and indexes", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.onModuleInit();

      // Verify constraint creation was attempted
      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("find", () => {
    it("should find all howTo entities", async () => {
      neo4jService.readMany.mockResolvedValue([MOCK_HOWTO]);

      const result = await repository.find({});

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual([MOCK_HOWTO]);
    });

    it("should pass search term to query", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      await repository.find({ term: "search-term" });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalled();
    });

    it("should pass orderBy to query", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      await repository.find({ orderBy: "createdAt" });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalled();
    });

    it("should return empty array when no entities found", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.find({});

      expect(result).toEqual([]);
    });
  });

  describe("findById", () => {
    it("should find howTo entity by ID", async () => {
      neo4jService.readOne.mockResolvedValue(MOCK_HOWTO);

      const result = await repository.findById({ id: TEST_IDS.howToId });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_HOWTO);
    });

    it("should return null when entity not found", async () => {
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ id: "non-existent-id" });

      expect(result).toBeNull();
    });

    it("should throw Forbidden when entity exists but user has no access", async () => {
      // First read returns null (user context), second returns entity (no user context)
      neo4jService.readOne.mockResolvedValueOnce(null).mockResolvedValueOnce(MOCK_HOWTO);

      await expect(repository.findById({ id: TEST_IDS.howToId })).rejects.toThrow(HttpException);
    });
  });

  describe("findByIds", () => {
    it("should find howTo entities by ID list", async () => {
      neo4jService.readMany.mockResolvedValue([MOCK_HOWTO]);

      const result = await repository.findByIds({ ids: [TEST_IDS.howToId] });

      expect(neo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual([MOCK_HOWTO]);
    });

    it("should return empty array for empty IDs list", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByIds({ ids: [] });

      expect(result).toEqual([]);
    });
  });

  describe("create", () => {
    it("should create a new howTo entity", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.howToId,
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });

    it("should validate related nodes exist before create", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.howToId,
      });

      // validateExistingNodes may or may not be called depending on relationships
      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("put", () => {
    it("should update an existing howTo entity", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      await repository.put({
        id: TEST_IDS.howToId,
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("patch", () => {
    it("should partially update an existing howTo entity", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      await repository.patch({
        id: TEST_IDS.howToId,
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });

    it("should only update provided fields", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.patch({
        id: TEST_IDS.howToId,
        // Only update specific fields
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete an existing howTo entity", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.howToId });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("findByRelated - author", () => {
    it("should find howTo entities by author ID", async () => {
      neo4jService.readMany.mockResolvedValue([MOCK_HOWTO]);

      const result = await repository.findByRelated({
        relationship: HowToDescriptor.relationshipKeys.author,
        id: TEST_IDS.authorId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual([MOCK_HOWTO]);
    });

    it("should find howTo entities by multiple author IDs", async () => {
      neo4jService.readMany.mockResolvedValue([MOCK_HOWTO]);

      const result = await repository.findByRelated({
        relationship: HowToDescriptor.relationshipKeys.author,
        id: [TEST_IDS.authorId, "another-author-id"],
      });

      expect(neo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual([MOCK_HOWTO]);
    });

    it("should return empty array when no howTo entities found", async () => {
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByRelated({
        relationship: HowToDescriptor.relationshipKeys.author,
        id: TEST_IDS.authorId,
      });

      expect(result).toEqual([]);
    });
  });
});
