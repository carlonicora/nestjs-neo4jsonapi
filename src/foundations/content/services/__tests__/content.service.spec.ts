import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ContentService } from "../content.service";
import { ContentRepository } from "../../repositories/content.repository";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { modelRegistry } from "../../../../common/registries/registry";

describe("ContentService", () => {
  let service: ContentService;
  let contentRepository: MockedObject<ContentRepository>;
  let jsonApiService: MockedObject<JsonApiService>;

  const TEST_IDS = {
    contentId1: "550e8400-e29b-41d4-a716-446655440000",
    contentId2: "660e8400-e29b-41d4-a716-446655440001",
    ownerId: "770e8400-e29b-41d4-a716-446655440002",
  };

  const MOCK_CONTENTS = [
    { id: TEST_IDS.contentId1, title: "Content 1" },
    { id: TEST_IDS.contentId2, title: "Content 2" },
  ];

  const createMockContentRepository = () => ({
    find: vi.fn(),
    findByIds: vi.fn(),
    findByOwner: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });

  const createMockJsonApiService = () => ({
    buildSingle: vi.fn(),
    buildList: vi.fn(),
    buildError: vi.fn(),
  });

  // ContentService serialises with the model ContentModule.forRoot() registered
  // (it carries the configured relationships / meta fields), so the registry
  // must be populated before the service runs.
  const REGISTERED_CONTENT_MODEL = {
    type: "contents",
    endpoint: "contents",
    nodeName: "content",
    labelName: "Content",
    entity: undefined,
    mapper: vi.fn(),
    serialiser: class {},
    singleChildrenTokens: ["company", "owner"],
    childrenTokens: [],
  } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    modelRegistry.register(REGISTERED_CONTENT_MODEL);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: ContentRepository, useValue: createMockContentRepository() },
        { provide: JsonApiService, useValue: createMockJsonApiService() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
    contentRepository = module.get(ContentRepository) as MockedObject<ContentRepository>;
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("model resolution", () => {
    it("should serialise with the model registered by ContentModule.forRoot", async () => {
      contentRepository.find.mockResolvedValue(MOCK_CONTENTS);
      jsonApiService.buildList.mockReturnValue({ data: MOCK_CONTENTS });

      await service.find({ query: {} });

      expect(jsonApiService.buildList).toHaveBeenCalledWith(REGISTERED_CONTENT_MODEL, MOCK_CONTENTS, expect.anything());
    });
  });

  describe("find", () => {
    it("should find content with pagination", async () => {
      // Arrange
      const mockJsonApiResponse = { data: MOCK_CONTENTS };
      contentRepository.find.mockResolvedValue(MOCK_CONTENTS);
      jsonApiService.buildList.mockReturnValue(mockJsonApiResponse);

      // Act
      const result = await service.find({ query: {} });

      // Assert
      expect(contentRepository.find).toHaveBeenCalledWith({
        fetchAll: undefined,
        term: undefined,
        orderBy: undefined,
        cursor: expect.anything(),
      });
      expect(jsonApiService.buildList).toHaveBeenCalled();
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should pass search term to repository", async () => {
      // Arrange
      contentRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.find({ query: {}, term: "search term" });

      // Assert
      expect(contentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          term: "search term",
        }),
      );
    });

    it("should pass fetchAll flag to repository", async () => {
      // Arrange
      contentRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.find({ query: {}, fetchAll: true });

      // Assert
      expect(contentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          fetchAll: true,
        }),
      );
    });

    it("should pass orderBy to repository", async () => {
      // Arrange
      contentRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.find({ query: {}, orderBy: "createdAt" });

      // Assert
      expect(contentRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: "createdAt",
        }),
      );
    });

    it("should handle pagination query parameters", async () => {
      // Arrange
      const query = { page: { size: 10, after: "cursor123" } };
      contentRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.find({ query });

      // Assert
      expect(contentRepository.find).toHaveBeenCalled();
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      contentRepository.find.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(service.find({ query: {} })).rejects.toThrow("Database error");
    });
  });

  describe("findByIds", () => {
    it("should find content by IDs", async () => {
      // Arrange
      const mockJsonApiResponse = { data: MOCK_CONTENTS };
      contentRepository.findByIds.mockResolvedValue(MOCK_CONTENTS);
      jsonApiService.buildList.mockReturnValue(mockJsonApiResponse);

      // Act
      const result = await service.findByIds({
        contentIds: [TEST_IDS.contentId1, TEST_IDS.contentId2],
      });

      // Assert
      expect(contentRepository.findByIds).toHaveBeenCalledWith({
        contentIds: [TEST_IDS.contentId1, TEST_IDS.contentId2],
      });
      expect(jsonApiService.buildList).toHaveBeenCalled();
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should handle empty ID array", async () => {
      // Arrange
      contentRepository.findByIds.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      const result = await service.findByIds({ contentIds: [] });

      // Assert
      expect(contentRepository.findByIds).toHaveBeenCalledWith({ contentIds: [] });
      expect(result).toEqual({ data: [] });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      contentRepository.findByIds.mockRejectedValue(new Error("Not found"));

      // Act & Assert
      await expect(service.findByIds({ contentIds: [TEST_IDS.contentId1] })).rejects.toThrow("Not found");
    });
  });

  describe("findByOwner", () => {
    it("should find content by owner with pagination", async () => {
      // Arrange
      const mockJsonApiResponse = { data: MOCK_CONTENTS };
      contentRepository.findByOwner.mockResolvedValue(MOCK_CONTENTS);
      jsonApiService.buildList.mockReturnValue(mockJsonApiResponse);

      // Act
      const result = await service.findByOwner({
        ownerId: TEST_IDS.ownerId,
        query: {},
      });

      // Assert
      expect(contentRepository.findByOwner).toHaveBeenCalledWith({
        ownerId: TEST_IDS.ownerId,
        fetchAll: undefined,
        term: undefined,
        orderBy: undefined,
        cursor: expect.anything(),
      });
      expect(jsonApiService.buildList).toHaveBeenCalled();
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should pass search term to repository", async () => {
      // Arrange
      contentRepository.findByOwner.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.findByOwner({
        ownerId: TEST_IDS.ownerId,
        query: {},
        term: "search term",
      });

      // Assert
      expect(contentRepository.findByOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          term: "search term",
        }),
      );
    });

    it("should pass fetchAll flag to repository", async () => {
      // Arrange
      contentRepository.findByOwner.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.findByOwner({
        ownerId: TEST_IDS.ownerId,
        query: {},
        fetchAll: true,
      });

      // Assert
      expect(contentRepository.findByOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          fetchAll: true,
        }),
      );
    });

    it("should pass orderBy to repository", async () => {
      // Arrange
      contentRepository.findByOwner.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.findByOwner({
        ownerId: TEST_IDS.ownerId,
        query: {},
        orderBy: "title",
      });

      // Assert
      expect(contentRepository.findByOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: "title",
        }),
      );
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      contentRepository.findByOwner.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(service.findByOwner({ ownerId: TEST_IDS.ownerId, query: {} })).rejects.toThrow("Database error");
    });
  });
});
