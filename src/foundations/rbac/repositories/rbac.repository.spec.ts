import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RbacRepository } from "./rbac.repository";
import { SystemRoles } from "../../../common/constants/system.roles";

describe("RbacRepository", () => {
  let repository: RbacRepository;
  let mockNeo4j: any;

  beforeEach(() => {
    mockNeo4j = {
      read: vi.fn(),
    };
  });

  afterEach(() => vi.clearAllMocks());

  describe("findPermissionMappings", () => {
    it("should query roles with HAS_PERMISSIONS relationships excluding Administrator", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            const data: Record<string, any> = {
              roleId: "role-1",
              moduleId: "mod-1",
              permissions: '[{"type":"read","value":true}]',
            };
            return data[key];
          }),
        },
      ];
      mockNeo4j.read.mockResolvedValue({ records: mockRecords });

      repository = new RbacRepository(mockNeo4j, {});
      const result = await repository.findPermissionMappings();

      expect(mockNeo4j.read).toHaveBeenCalledWith(
        expect.stringContaining("HAS_PERMISSIONS"),
        expect.objectContaining({ administratorRoleId: SystemRoles.Administrator }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].roleId).toBe("role-1");
      expect(result[0].moduleId).toBe("mod-1");
      expect(result[0].permissions).toEqual({ read: true });
    });

    it("should return empty array when no permission mappings exist", async () => {
      mockNeo4j.read.mockResolvedValue({ records: [] });

      repository = new RbacRepository(mockNeo4j, {});
      const result = await repository.findPermissionMappings();

      expect(result).toEqual([]);
    });

    it("should construct composite id from roleId:moduleId", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            const data: Record<string, any> = {
              roleId: "r1",
              moduleId: "m1",
              permissions: "[]",
            };
            return data[key];
          }),
        },
      ];
      mockNeo4j.read.mockResolvedValue({ records: mockRecords });

      repository = new RbacRepository(mockNeo4j, {});
      const result = await repository.findPermissionMappings();

      expect(result[0].id).toBe("r1:m1");
    });
  });

  describe("findModuleRelationshipPaths", () => {
    it("should return modules with paths from injected MODULE_USER_PATHS", async () => {
      const moduleUserPaths = {
        pipelines: ["owner", "company.user"],
      };
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            const data: Record<string, any> = {
              moduleId: "mod-1",
              moduleName: "Pipelines",
            };
            return data[key];
          }),
        },
      ];
      mockNeo4j.read.mockResolvedValue({ records: mockRecords });

      repository = new RbacRepository(mockNeo4j, moduleUserPaths);
      const result = await repository.findModuleRelationshipPaths();

      expect(result).toHaveLength(1);
      expect(result[0].moduleId).toBe("mod-1");
      expect(result[0].paths).toEqual(["owner", "company.user"]);
    });

    it("should return empty paths when module has no matching entry in MODULE_USER_PATHS", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            const data: Record<string, any> = {
              moduleId: "mod-1",
              moduleName: "Unknowns",
            };
            return data[key];
          }),
        },
      ];
      mockNeo4j.read.mockResolvedValue({ records: mockRecords });

      repository = new RbacRepository(mockNeo4j, {});
      const result = await repository.findModuleRelationshipPaths();

      expect(result[0].paths).toEqual([]);
    });
  });
});
