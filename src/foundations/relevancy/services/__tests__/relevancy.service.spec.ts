import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { RelevancyService } from "../relevancy.service";
import { RelevancyRepository } from "../../repositories/relevancy.repository";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";
import type { User } from "../../../user/entities/user";

describe("RelevancyService", () => {
  let service: RelevancyService<any>;
  let jsonApiService: MockedObject<JsonApiService>;
  let relevancyRepository: MockedObject<RelevancyRepository<any>>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    contentId: "660e8400-e29b-41d4-a716-446655440001",
  };

  const MOCK_MODEL: DataModelInterface<any> = {
    type: "test-entities",
    endpoint: "test-entities",
    nodeName: "testEntity",
    labelName: "TestEntity",
    entity: undefined,
    mapper: vi.fn(),
  };

  const MOCK_CYPHER_SERVICE = {
    run: vi.fn(),
  };

  const MOCK_RESULTS = [
    { id: "result-1", name: "Result 1" },
    { id: "result-2", name: "Result 2" },
  ];

  const MOCK_JSON_API_RESPONSE = {
    data: [
      { type: "test-entities", id: "result-1", attributes: { name: "Result 1" } },
      { type: "test-entities", id: "result-2", attributes: { name: "Result 2" } },
    ],
  };

  const createMockJsonApiService = () => ({
    buildSingle: vi.fn(),
    buildList: vi.fn(),
    buildMany: vi.fn(),
  });

  const createMockRelevancyRepository = () => ({
    findByUser: vi.fn(),
    findById: vi.fn(),
    findUsersById: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelevancyService,
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: RelevancyRepository, useValue: createMockRelevancyRepository() },
      ],
    }).compile();

    service = module.get<RelevancyService<any>>(RelevancyService);
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
    relevancyRepository = module.get(RelevancyRepository) as MockedObject<RelevancyRepository<any>>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("findRelevantByUser", () => {
    it("should find relevant items by user ID", async () => {
      // Arrange
      relevancyRepository.findByUser.mockResolvedValue(MOCK_RESULTS);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      // Act
      const result = await service.findRelevantByUser({
        model: MOCK_MODEL,
        cypherService: MOCK_CYPHER_SERVICE,
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(relevancyRepository.findByUser).toHaveBeenCalledWith(
        expect.objectContaining({
          model: MOCK_MODEL,
          cypherService: MOCK_CYPHER_SERVICE,
          id: TEST_IDS.userId,
        }),
      );
      expect(jsonApiService.buildList).toHaveBeenCalledWith(MOCK_MODEL, MOCK_RESULTS, expect.any(Object));
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should pass query parameters for pagination", async () => {
      // Arrange
      const query = { page: { number: 2, size: 10 } };
      relevancyRepository.findByUser.mockResolvedValue(MOCK_RESULTS);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      // Act
      await service.findRelevantByUser({
        model: MOCK_MODEL,
        cypherService: MOCK_CYPHER_SERVICE,
        userId: TEST_IDS.userId,
        query,
      });

      // Assert
      expect(relevancyRepository.findByUser).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: expect.any(Object),
        }),
      );
    });

    it("should handle empty results", async () => {
      // Arrange
      relevancyRepository.findByUser.mockResolvedValue([]);
      jsonApiService.buildList.mockResolvedValue({ data: [] });

      // Act
      const result = await service.findRelevantByUser({
        model: MOCK_MODEL,
        cypherService: MOCK_CYPHER_SERVICE,
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(result).toEqual({ data: [] });
    });
  });

  describe("findRelevant", () => {
    it("should find relevant items by ID", async () => {
      // Arrange
      relevancyRepository.findById.mockResolvedValue(MOCK_RESULTS);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      // Act
      const result = await service.findRelevant({
        model: MOCK_MODEL,
        cypherService: MOCK_CYPHER_SERVICE,
        id: TEST_IDS.contentId,
      });

      // Assert
      expect(relevancyRepository.findById).toHaveBeenCalledWith(
        expect.objectContaining({
          model: MOCK_MODEL,
          cypherService: MOCK_CYPHER_SERVICE,
          id: TEST_IDS.contentId,
        }),
      );
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should pass query parameters for pagination", async () => {
      // Arrange
      const query = { page: { number: 1, size: 5 } };
      relevancyRepository.findById.mockResolvedValue(MOCK_RESULTS);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      // Act
      await service.findRelevant({
        model: MOCK_MODEL,
        cypherService: MOCK_CYPHER_SERVICE,
        id: TEST_IDS.contentId,
        query,
      });

      // Assert
      expect(relevancyRepository.findById).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: expect.any(Object),
        }),
      );
    });

    it("should handle empty results", async () => {
      // Arrange
      relevancyRepository.findById.mockResolvedValue([]);
      jsonApiService.buildList.mockResolvedValue({ data: [] });

      // Act
      const result = await service.findRelevant({
        model: MOCK_MODEL,
        cypherService: MOCK_CYPHER_SERVICE,
        id: TEST_IDS.contentId,
      });

      // Assert
      expect(result).toEqual({ data: [] });
    });
  });

  describe("findRelevantUsers", () => {
    const MOCK_USERS: User[] = [{ id: "user-1", name: "User 1" } as User, { id: "user-2", name: "User 2" } as User];

    const MOCK_USERS_RESPONSE = {
      data: [
        { type: "users", id: "user-1", attributes: { name: "User 1" } },
        { type: "users", id: "user-2", attributes: { name: "User 2" } },
      ],
    };

    it("should find relevant users by ID", async () => {
      // Arrange
      relevancyRepository.findUsersById.mockResolvedValue(MOCK_USERS);
      jsonApiService.buildList.mockResolvedValue(MOCK_USERS_RESPONSE);

      // Act
      const result = await service.findRelevantUsers({
        cypherService: MOCK_CYPHER_SERVICE,
        id: TEST_IDS.contentId,
      });

      // Assert
      expect(relevancyRepository.findUsersById).toHaveBeenCalledWith(
        expect.objectContaining({
          cypherService: MOCK_CYPHER_SERVICE,
          id: TEST_IDS.contentId,
        }),
      );
      expect(result).toEqual(MOCK_USERS_RESPONSE);
    });

    it("should pass query parameters for pagination", async () => {
      // Arrange
      const query = { page: { number: 1, size: 20 } };
      relevancyRepository.findUsersById.mockResolvedValue(MOCK_USERS);
      jsonApiService.buildList.mockResolvedValue(MOCK_USERS_RESPONSE);

      // Act
      await service.findRelevantUsers({
        cypherService: MOCK_CYPHER_SERVICE,
        id: TEST_IDS.contentId,
        query,
      });

      // Assert
      expect(relevancyRepository.findUsersById).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: expect.any(Object),
        }),
      );
    });

    it("should handle empty results", async () => {
      // Arrange
      relevancyRepository.findUsersById.mockResolvedValue([]);
      jsonApiService.buildList.mockResolvedValue({ data: [] });

      // Act
      const result = await service.findRelevantUsers({
        cypherService: MOCK_CYPHER_SERVICE,
        id: TEST_IDS.contentId,
      });

      // Assert
      expect(result).toEqual({ data: [] });
    });
  });
});
