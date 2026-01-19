import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock roleMeta
vi.mock("../entities/role.meta", () => ({
  roleMeta: {
    type: "roles",
    endpoint: "roles",
    nodeName: "role",
    labelName: "Role",
  },
}));

// Mock role service
vi.mock("../services/role.service", () => ({
  RoleService: vi.fn().mockImplementation(() => ({
    find: vi.fn(),
    findById: vi.fn(),
    expectNotExists: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
}));

import { HttpException, HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { RolePostDTO } from "../dtos/role.post.dto";
import { RoleService } from "../services/role.service";
import { RoleController } from "./role.controller";

describe("RoleController", () => {
  let controller: RoleController;
  let roleService: vi.Mocked<RoleService>;

  // Test data constants
  const MOCK_ROLE_ID = "550e8400-e29b-41d4-a716-446655440000";
  const MOCK_ROLE_ID_2 = "550e8400-e29b-41d4-a716-446655440001";

  const mockServiceResponse: JsonApiDataInterface = {
    type: "roles",
    id: MOCK_ROLE_ID,
    attributes: {
      name: "Administrator",
      description: "Full system access",
    },
  };

  const mockListResponse = {
    data: [mockServiceResponse],
    meta: { total: 1 },
  };

  beforeEach(async () => {
    const mockRoleService = {
      find: vi.fn(),
      findById: vi.fn(),
      expectNotExists: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoleController],
      providers: [{ provide: RoleService, useValue: mockRoleService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RoleController>(RoleController);
    roleService = module.get(RoleService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("find", () => {
    const mockQuery = { page: { number: 1, size: 10 } };

    it("should find roles with search term", async () => {
      const search = "admin";
      roleService.find.mockResolvedValue(mockListResponse);

      const result = await controller.find(mockQuery, search);

      expect(roleService.find).toHaveBeenCalledWith({
        term: search,
        query: mockQuery,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should find roles without search term", async () => {
      roleService.find.mockResolvedValue(mockListResponse);

      const result = await controller.find(mockQuery);

      expect(roleService.find).toHaveBeenCalledWith({
        term: undefined,
        query: mockQuery,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should find roles with empty query", async () => {
      const emptyQuery = {};
      roleService.find.mockResolvedValue(mockListResponse);

      const result = await controller.find(emptyQuery);

      expect(roleService.find).toHaveBeenCalledWith({
        term: undefined,
        query: emptyQuery,
      });
      expect(result).toEqual(mockListResponse);
    });

    it("should handle service errors", async () => {
      roleService.find.mockRejectedValue(new Error("Service error"));

      await expect(controller.find(mockQuery)).rejects.toThrow("Service error");
    });
  });

  describe("findById", () => {
    it("should find role by ID", async () => {
      roleService.findById.mockResolvedValue(mockServiceResponse);

      const result = await controller.findById(MOCK_ROLE_ID);

      expect(roleService.findById).toHaveBeenCalledWith({
        roleId: MOCK_ROLE_ID,
      });
      expect(result).toEqual(mockServiceResponse);
    });

    it("should handle service errors", async () => {
      roleService.findById.mockRejectedValue(new Error("Role not found"));

      await expect(controller.findById(MOCK_ROLE_ID)).rejects.toThrow("Role not found");
    });

    it("should handle non-existent role", async () => {
      roleService.findById.mockResolvedValue(null);

      const result = await controller.findById("non-existent-id");

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    const createDto: RolePostDTO = {
      data: {
        type: "roles",
        attributes: {
          name: "New Role",
          description: "A new role",
        },
      },
    } as any;

    it("should create a new role", async () => {
      roleService.expectNotExists.mockResolvedValue(undefined);
      roleService.create.mockResolvedValue(mockServiceResponse);

      const result = await controller.create(createDto);

      expect(roleService.expectNotExists).toHaveBeenCalledWith({
        name: "New Role",
      });
      expect(roleService.create).toHaveBeenCalledWith({
        data: createDto.data,
      });
      expect(result).toEqual(mockServiceResponse);
    });

    it("should throw when role already exists", async () => {
      roleService.expectNotExists.mockRejectedValue(new Error("Role already exists"));

      await expect(controller.create(createDto)).rejects.toThrow("Role already exists");

      expect(roleService.expectNotExists).toHaveBeenCalled();
      expect(roleService.create).not.toHaveBeenCalled();
    });

    it("should handle service errors during creation", async () => {
      roleService.expectNotExists.mockResolvedValue(undefined);
      roleService.create.mockRejectedValue(new Error("Creation failed"));

      await expect(controller.create(createDto)).rejects.toThrow("Creation failed");
    });
  });

  describe("update", () => {
    const updateDto: RolePostDTO = {
      data: {
        type: "roles",
        id: MOCK_ROLE_ID,
        attributes: {
          name: "Updated Role",
          description: "Updated description",
        },
      },
    } as any;

    it("should update a role", async () => {
      roleService.update.mockResolvedValue({ ...mockServiceResponse, attributes: { name: "Updated Role" } });

      const result = await controller.update(updateDto, MOCK_ROLE_ID);

      expect(roleService.update).toHaveBeenCalledWith({
        data: updateDto.data,
      });
      expect(result.attributes.name).toBe("Updated Role");
    });

    it("should throw PRECONDITION_FAILED when IDs do not match", async () => {
      await expect(controller.update(updateDto, MOCK_ROLE_ID_2)).rejects.toThrow(
        new HttpException("Role id does not match the {json:api} id", HttpStatus.PRECONDITION_FAILED),
      );

      expect(roleService.update).not.toHaveBeenCalled();
    });

    it("should handle service errors during update", async () => {
      roleService.update.mockRejectedValue(new Error("Update failed"));

      await expect(controller.update(updateDto, MOCK_ROLE_ID)).rejects.toThrow("Update failed");
    });
  });

  describe("delete", () => {
    it("should delete a role", async () => {
      roleService.delete.mockResolvedValue(undefined);

      await controller.delete(MOCK_ROLE_ID);

      expect(roleService.delete).toHaveBeenCalledWith({
        roleId: MOCK_ROLE_ID,
      });
    });

    it("should handle service errors during deletion", async () => {
      roleService.delete.mockRejectedValue(new Error("Deletion failed"));

      await expect(controller.delete(MOCK_ROLE_ID)).rejects.toThrow("Deletion failed");
    });

    it("should handle non-existent role deletion", async () => {
      roleService.delete.mockRejectedValue(new Error("Role not found"));

      await expect(controller.delete("non-existent-id")).rejects.toThrow("Role not found");
    });
  });

  describe("dependency injection", () => {
    it("should have roleService injected", () => {
      expect(controller["roleService"]).toBeDefined();
    });
  });
});
