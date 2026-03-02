import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RbacService } from "./rbac.service";

describe("RbacService", () => {
  let service: RbacService;
  let mockRepository: any;
  let mockJsonApiService: any;

  beforeEach(() => {
    mockRepository = {
      findPermissionMappings: vi.fn(),
      findModuleRelationshipPaths: vi.fn(),
    };
    mockJsonApiService = {
      buildList: vi.fn().mockReturnValue({ data: [] }),
    };
    service = new RbacService(mockRepository, mockJsonApiService);
  });

  afterEach(() => vi.clearAllMocks());

  describe("findPermissionMappings", () => {
    it("should call repository and build JSON:API list response", async () => {
      const mockData = [{ id: "r1:m1", roleId: "r1", moduleId: "m1" }];
      mockRepository.findPermissionMappings.mockResolvedValue(mockData);

      await service.findPermissionMappings();

      expect(mockRepository.findPermissionMappings).toHaveBeenCalled();
      expect(mockJsonApiService.buildList).toHaveBeenCalledWith(
        expect.objectContaining({ type: "permission-mappings" }),
        mockData,
      );
    });
  });

  describe("findModuleRelationshipPaths", () => {
    it("should call repository and build JSON:API list response", async () => {
      const mockData = [{ id: "m1", moduleId: "m1", paths: ["owner"] }];
      mockRepository.findModuleRelationshipPaths.mockResolvedValue(mockData);

      await service.findModuleRelationshipPaths();

      expect(mockRepository.findModuleRelationshipPaths).toHaveBeenCalled();
      expect(mockJsonApiService.buildList).toHaveBeenCalledWith(
        expect.objectContaining({ type: "module-paths" }),
        mockData,
      );
    });
  });
});
