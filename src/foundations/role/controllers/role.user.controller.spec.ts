import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock metas
vi.mock("../entities/role.meta", () => ({
  roleMeta: {
    type: "roles",
    endpoint: "roles",
    nodeName: "role",
    labelName: "Role",
  },
}));

vi.mock("../../user/entities/user.meta", () => ({
  userMeta: {
    type: "users",
    endpoint: "users",
    nodeName: "user",
    labelName: "User",
  },
}));

// Mock role service
vi.mock("../services/role.service", () => ({
  RoleService: vi.fn().mockImplementation(() => ({
    findForUser: vi.fn(),
    findNotInUser: vi.fn(),
  })),
}));

// Mock security service
vi.mock("../../../core/security/services/security.service", () => ({
  SecurityService: vi.fn().mockImplementation(() => ({})),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { SecurityService } from "../../../core/security/services/security.service";
import { RoleService } from "../services/role.service";
import { RoleUserController } from "./role.user.controller";

describe("RoleUserController", () => {
  let controller: RoleUserController;
  let roleService: vi.Mocked<RoleService>;

  // Test data constants
  const MOCK_USER_ID = "550e8400-e29b-41d4-a716-446655440000";

  const mockRolesResponse = {
    data: [
      {
        type: "roles",
        id: "role-1",
        attributes: {
          name: "Administrator",
          description: "Full system access",
        },
      },
      {
        type: "roles",
        id: "role-2",
        attributes: {
          name: "Editor",
          description: "Content editing access",
        },
      },
    ],
    meta: { total: 2 },
  };

  const mockRequest = { user: { id: MOCK_USER_ID } };

  beforeEach(async () => {
    const mockRoleService = {
      findForUser: vi.fn(),
      findNotInUser: vi.fn(),
    };

    const mockSecurityService = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoleUserController],
      providers: [
        { provide: RoleService, useValue: mockRoleService },
        { provide: SecurityService, useValue: mockSecurityService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RoleUserController>(RoleUserController);
    roleService = module.get(RoleService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findBySearch", () => {
    const mockQuery = { page: { number: 1, size: 10 } };

    describe("when userNotIn is falsy", () => {
      it("should find roles for user without search term", async () => {
        roleService.findForUser.mockResolvedValue(mockRolesResponse);

        const result = await controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID);

        expect(roleService.findForUser).toHaveBeenCalledWith({
          userId: MOCK_USER_ID,
          term: undefined,
          query: mockQuery,
        });
        expect(roleService.findNotInUser).not.toHaveBeenCalled();
        expect(result).toEqual(mockRolesResponse);
      });

      it("should find roles for user with search term", async () => {
        const search = "admin";
        roleService.findForUser.mockResolvedValue(mockRolesResponse);

        const result = await controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID, search);

        expect(roleService.findForUser).toHaveBeenCalledWith({
          userId: MOCK_USER_ID,
          term: search,
          query: mockQuery,
        });
        expect(result).toEqual(mockRolesResponse);
      });

      it("should find roles for user with userNotIn explicitly false", async () => {
        roleService.findForUser.mockResolvedValue(mockRolesResponse);

        const result = await controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID, undefined, false);

        expect(roleService.findForUser).toHaveBeenCalledWith({
          userId: MOCK_USER_ID,
          term: undefined,
          query: mockQuery,
        });
        expect(roleService.findNotInUser).not.toHaveBeenCalled();
        expect(result).toEqual(mockRolesResponse);
      });

      it("should handle service errors", async () => {
        roleService.findForUser.mockRejectedValue(new Error("Service error"));

        await expect(controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID)).rejects.toThrow("Service error");
      });

      it("should handle empty results", async () => {
        const emptyResponse = { data: [], meta: { total: 0 } };
        roleService.findForUser.mockResolvedValue(emptyResponse);

        const result = await controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID);

        expect(result).toEqual(emptyResponse);
      });
    });

    describe("when userNotIn is truthy", () => {
      it("should find roles not assigned to user without search term", async () => {
        roleService.findNotInUser.mockResolvedValue(mockRolesResponse);

        const result = await controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID, undefined, true);

        expect(roleService.findNotInUser).toHaveBeenCalledWith({
          userId: MOCK_USER_ID,
          term: undefined,
          query: mockQuery,
        });
        expect(roleService.findForUser).not.toHaveBeenCalled();
        expect(result).toEqual(mockRolesResponse);
      });

      it("should find roles not assigned to user with search term", async () => {
        const search = "editor";
        roleService.findNotInUser.mockResolvedValue(mockRolesResponse);

        const result = await controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID, search, true);

        expect(roleService.findNotInUser).toHaveBeenCalledWith({
          userId: MOCK_USER_ID,
          term: search,
          query: mockQuery,
        });
        expect(result).toEqual(mockRolesResponse);
      });

      it("should handle service errors", async () => {
        roleService.findNotInUser.mockRejectedValue(new Error("Service error"));

        await expect(controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID, undefined, true)).rejects.toThrow(
          "Service error",
        );
      });

      it("should handle empty results", async () => {
        const emptyResponse = { data: [], meta: { total: 0 } };
        roleService.findNotInUser.mockResolvedValue(emptyResponse);

        const result = await controller.findBySearch(mockRequest, mockQuery, MOCK_USER_ID, undefined, true);

        expect(result).toEqual(emptyResponse);
      });
    });

    describe("with different query parameters", () => {
      it("should handle empty query object", async () => {
        const emptyQuery = {};
        roleService.findForUser.mockResolvedValue(mockRolesResponse);

        const result = await controller.findBySearch(mockRequest, emptyQuery, MOCK_USER_ID);

        expect(roleService.findForUser).toHaveBeenCalledWith({
          userId: MOCK_USER_ID,
          term: undefined,
          query: emptyQuery,
        });
        expect(result).toEqual(mockRolesResponse);
      });

      it("should handle query with filters", async () => {
        const queryWithFilters = {
          page: { number: 2, size: 25 },
          filter: { active: true },
        };
        roleService.findForUser.mockResolvedValue(mockRolesResponse);

        const result = await controller.findBySearch(mockRequest, queryWithFilters, MOCK_USER_ID);

        expect(roleService.findForUser).toHaveBeenCalledWith({
          userId: MOCK_USER_ID,
          term: undefined,
          query: queryWithFilters,
        });
        expect(result).toEqual(mockRolesResponse);
      });
    });
  });

  describe("dependency injection", () => {
    it("should have roleService injected", () => {
      expect(controller["roleServide"]).toBeDefined();
    });

    it("should have securityService injected", () => {
      expect(controller["security"]).toBeDefined();
    });
  });
});
