import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { FeatureService } from "../feature.service";
import { FeatureRepository } from "../../repositories/feature.repository";
import { FeatureDescriptor } from "../../entities/feature";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";

describe("FeatureService", () => {
  let service: FeatureService;
  let featureRepository: MockedObject<FeatureRepository>;
  let jsonApiService: MockedObject<JsonApiService>;

  const TEST_IDS = {
    featureId1: "550e8400-e29b-41d4-a716-446655440000",
    featureId2: "660e8400-e29b-41d4-a716-446655440001",
    companyId: "770e8400-e29b-41d4-a716-446655440002",
  };

  const MOCK_FEATURES = [
    { id: TEST_IDS.featureId1, name: "Feature 1", isCore: true },
    { id: TEST_IDS.featureId2, name: "Feature 2", isCore: false },
  ];

  const createMockFeatureRepository = () => ({
    find: vi.fn(),
    findByCompany: vi.fn(),
    findByName: vi.fn(),
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

  const createMockClsService = () => ({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureService,
        { provide: FeatureRepository, useValue: createMockFeatureRepository() },
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: ClsService, useValue: createMockClsService() },
      ],
    }).compile();

    service = module.get<FeatureService>(FeatureService);
    featureRepository = module.get(FeatureRepository) as MockedObject<FeatureRepository>;
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

  describe("find", () => {
    it("should find features with pagination and default to name ASC ordering", async () => {
      // Arrange
      const mockJsonApiResponse = { data: MOCK_FEATURES };
      featureRepository.find.mockResolvedValue(MOCK_FEATURES);
      jsonApiService.buildList.mockReturnValue(mockJsonApiResponse);

      // Act
      const result = await service.find({ query: {} });

      // Assert
      expect(featureRepository.find).toHaveBeenCalledWith({
        fetchAll: undefined,
        term: undefined,
        orderBy: "name ASC",
        cursor: expect.anything(),
      });
      expect(jsonApiService.buildList).toHaveBeenCalledWith(FeatureDescriptor.model, MOCK_FEATURES, expect.anything());
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should pass search term to repository", async () => {
      // Arrange
      featureRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.find({ query: {}, term: "search term" });

      // Assert
      expect(featureRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          term: "search term",
        }),
      );
    });

    it("should honour an explicit orderBy over the name ASC default", async () => {
      // Arrange
      featureRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.find({ query: {}, orderBy: "isCore DESC" });

      // Assert
      expect(featureRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: "isCore DESC",
        }),
      );
    });

    it("should pass fetchAll through to the repository", async () => {
      // Arrange
      featureRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.find({ query: {}, fetchAll: true });

      // Assert
      expect(featureRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          fetchAll: true,
        }),
      );
    });

    it("should handle pagination query parameters", async () => {
      // Arrange
      const query = { page: { size: 10, after: "cursor123" } };
      featureRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      await service.find({ query });

      // Assert
      expect(featureRepository.find).toHaveBeenCalled();
    });

    it("should return empty list when no features found", async () => {
      // Arrange
      featureRepository.find.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      const result = await service.find({ query: {} });

      // Assert
      expect(result).toEqual({ data: [] });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      featureRepository.find.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(service.find({ query: {} })).rejects.toThrow("Database error");
    });
  });

  describe("findByCompany", () => {
    it("should find features by company ID", async () => {
      // Arrange
      const mockJsonApiResponse = { data: MOCK_FEATURES };
      featureRepository.findByCompany.mockResolvedValue(MOCK_FEATURES);
      jsonApiService.buildList.mockReturnValue(mockJsonApiResponse);

      // Act
      const result = await service.findByCompany({ companyId: TEST_IDS.companyId });

      // Assert
      expect(featureRepository.findByCompany).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
      });
      expect(jsonApiService.buildList).toHaveBeenCalledWith(FeatureDescriptor.model, MOCK_FEATURES);
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should return empty list when no features found for company", async () => {
      // Arrange
      featureRepository.findByCompany.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] });

      // Act
      const result = await service.findByCompany({ companyId: TEST_IDS.companyId });

      // Assert
      expect(result).toEqual({ data: [] });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      featureRepository.findByCompany.mockRejectedValue(new Error("Company not found"));

      // Act & Assert
      await expect(service.findByCompany({ companyId: TEST_IDS.companyId })).rejects.toThrow("Company not found");
    });
  });
});
