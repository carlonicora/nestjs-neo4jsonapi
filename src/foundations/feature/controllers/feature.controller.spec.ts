import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

vi.mock("../../../common/guards/jwt.auth.admin.guard", () => ({
  AdminJwtAuthGuard: class MockAdminJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock featureMeta used in controller decorator
vi.mock("../entities/feature.meta", () => ({
  featureMeta: {
    type: "features",
    endpoint: "features",
    nodeName: "feature",
    labelName: "Feature",
  },
}));

// Mock feature service to avoid complex dependency chain
vi.mock("../services/feature.service", () => ({
  FeatureService: vi.fn().mockImplementation(() => ({
    find: vi.fn(),
  })),
}));

// Mock roles decorator
vi.mock("../../../common/decorators/roles.decorator", () => ({
  Roles: () => () => {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { FeatureService } from "../services/feature.service";
import { FeatureController } from "./feature.controller";

describe("FeatureController", () => {
  let controller: FeatureController;
  let featureService: vi.Mocked<FeatureService>;

  // Test data constants
  const MOCK_FEATURE_ID = "550e8400-e29b-41d4-a716-446655440000";
  const MOCK_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
  const MOCK_COMPANY_ID = "770e8400-e29b-41d4-a716-446655440002";

  const mockAdminUser = {
    userId: MOCK_USER_ID,
    companyId: MOCK_COMPANY_ID,
    roles: ["Administrator"],
    language: "en",
  };

  const mockRequest = { user: mockAdminUser };

  const mockServiceResponse: JsonApiDataInterface = {
    type: "features",
    id: MOCK_FEATURE_ID,
    attributes: {
      name: "Test Feature",
      description: "A test feature",
    },
  };

  const mockListResponse = {
    data: [mockServiceResponse],
    meta: { total: 1 },
  };

  beforeEach(async () => {
    const mockFeatureService = {
      find: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeatureController],
      providers: [{ provide: FeatureService, useValue: mockFeatureService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<FeatureController>(FeatureController);
    featureService = module.get(FeatureService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findBySearch", () => {
    const mockQuery = { page: { number: 1, size: 10 } };

    it("should find features with search term and query parameters", async () => {
      const search = "test search";
      featureService.find.mockResolvedValue(mockListResponse);

      const result = await controller.findBySearch(mockRequest, mockQuery, search);

      expect(featureService.find).toHaveBeenCalledWith({
        query: mockQuery,
        term: search,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should find features without search term", async () => {
      featureService.find.mockResolvedValue(mockListResponse);

      const result = await controller.findBySearch(mockRequest, mockQuery);

      expect(featureService.find).toHaveBeenCalledWith({
        query: mockQuery,
        term: undefined,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should find features with empty query", async () => {
      const emptyQuery = {};
      featureService.find.mockResolvedValue(mockListResponse);

      const result = await controller.findBySearch(mockRequest, emptyQuery);

      expect(featureService.find).toHaveBeenCalledWith({
        query: emptyQuery,
        term: undefined,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should handle empty string search parameter", async () => {
      const emptySearch = "";
      featureService.find.mockResolvedValue(mockListResponse);

      const result = await controller.findBySearch(mockRequest, mockQuery, emptySearch);

      expect(featureService.find).toHaveBeenCalledWith({
        query: mockQuery,
        term: emptySearch,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should handle service errors", async () => {
      const serviceError = new Error("Service error");
      featureService.find.mockRejectedValue(serviceError);

      await expect(controller.findBySearch(mockRequest, mockQuery)).rejects.toThrow("Service error");

      expect(featureService.find).toHaveBeenCalled();
    });

    it("should return empty results when no features found", async () => {
      const emptyResponse = { data: [], meta: { total: 0 } };
      featureService.find.mockResolvedValue(emptyResponse);

      const result = await controller.findBySearch(mockRequest, mockQuery);

      expect(result).toEqual(emptyResponse);
    });

    it("should handle null service response", async () => {
      featureService.find.mockResolvedValue(null);

      const result = await controller.findBySearch(mockRequest, mockQuery);

      expect(result).toBeNull();
    });

    it("should handle undefined service response", async () => {
      featureService.find.mockResolvedValue(undefined);

      const result = await controller.findBySearch(mockRequest, mockQuery);

      expect(result).toBeUndefined();
    });

    it("should pass request object (containing user) to the method", async () => {
      featureService.find.mockResolvedValue(mockListResponse);

      await controller.findBySearch(mockRequest, mockQuery);

      // The method receives the request but doesn't use it in the service call
      // This test verifies the controller method signature accepts the request
      expect(featureService.find).toHaveBeenCalledTimes(1);
    });
  });

  describe("dependency injection", () => {
    it("should have featureService injected", () => {
      expect(controller["featureService"]).toBeDefined();
    });
  });
});
