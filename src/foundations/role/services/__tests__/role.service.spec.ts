import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { RoleService } from "../role.service";
import { RoleRepository } from "../../repositories/role.repository";
import { Role } from "../../entities/role";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";

describe("RoleService", () => {
  let service: RoleService;
  let jsonApiService: MockedObject<JsonApiService>;
  let roleRepository: MockedObject<RoleRepository>;

  const TEST_IDS = {
    roleId: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440001",
  };

  const MOCK_DATE = new Date("2025-01-01T00:00:00Z");

  const MOCK_ROLE: Role = {
    id: TEST_IDS.roleId,
    type: "roles",
    createdAt: MOCK_DATE,
    updatedAt: MOCK_DATE,
    name: "Administrator",
    description: "System administrator role",
  };

  const MOCK_ROLES: Role[] = [
    { ...MOCK_ROLE, description: "Admin role" },
    { ...MOCK_ROLE, id: "role-2", name: "Editor", description: "Editor role" },
  ];

  const MOCK_JSON_API_SINGLE = {
    data: { type: "roles", id: TEST_IDS.roleId, attributes: { name: "Administrator" } },
  };

  const MOCK_JSON_API_LIST = {
    data: [
      { type: "roles", id: TEST_IDS.roleId, attributes: { name: "Administrator" } },
      { type: "roles", id: "role-2", attributes: { name: "Editor" } },
    ],
  };

  const createMockJsonApiService = () => ({
    buildSingle: vi.fn(),
    buildList: vi.fn(),
    buildMany: vi.fn(),
  });

  const createMockRoleRepository = () => ({
    findById: vi.fn(),
    findByName: vi.fn(),
    findByNameNotId: vi.fn(),
    find: vi.fn(),
    findForUser: vi.fn(),
    findNotInUser: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: RoleRepository, useValue: createMockRoleRepository() },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
    roleRepository = module.get(RoleRepository) as MockedObject<RoleRepository>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("expectNotExists", () => {
    it("should not throw when role does not exist", async () => {
      // Arrange
      roleRepository.findByName.mockResolvedValue(null);

      // Act & Assert
      await expect(service.expectNotExists({ name: "New Role" })).resolves.toBeUndefined();
      expect(roleRepository.findByName).toHaveBeenCalledWith({ name: "New Role" });
    });

    it("should throw CONFLICT when role already exists", async () => {
      // Arrange
      roleRepository.findByName.mockResolvedValue(MOCK_ROLE);

      // Act & Assert
      await expect(service.expectNotExists({ name: "Administrator" })).rejects.toThrow(
        new HttpException("A role with the given name already exists", HttpStatus.CONFLICT),
      );
    });
  });

  describe("findById", () => {
    it("should find role by ID and return JSON:API format", async () => {
      // Arrange
      roleRepository.findById.mockResolvedValue(MOCK_ROLE);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_SINGLE);

      // Act
      const result = await service.findById({ roleId: TEST_IDS.roleId });

      // Assert
      expect(roleRepository.findById).toHaveBeenCalledWith({ roleId: TEST_IDS.roleId });
      expect(result).toEqual(MOCK_JSON_API_SINGLE);
    });
  });

  describe("find", () => {
    it("should find roles with pagination", async () => {
      // Arrange
      const query = { page: { number: 1, size: 10 } };
      roleRepository.find.mockResolvedValue(MOCK_ROLES);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_LIST);

      // Act
      const result = await service.find({ query });

      // Assert
      expect(roleRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: expect.any(Object),
        }),
      );
      expect(result).toEqual(MOCK_JSON_API_LIST);
    });

    it("should pass search term to repository", async () => {
      // Arrange
      const query = {};
      const term = "Admin";
      roleRepository.find.mockResolvedValue([MOCK_ROLES[0]]);
      jsonApiService.buildList.mockResolvedValue({ data: [MOCK_JSON_API_LIST.data[0]] });

      // Act
      await service.find({ term, query });

      // Assert
      expect(roleRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          term,
        }),
      );
    });
  });

  describe("findForUser", () => {
    it("should find roles assigned to a user", async () => {
      // Arrange
      const query = {};
      roleRepository.findForUser.mockResolvedValue(MOCK_ROLES);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_LIST);

      // Act
      const result = await service.findForUser({
        userId: TEST_IDS.userId,
        term: "",
        query,
      });

      // Assert
      expect(roleRepository.findForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          term: "",
        }),
      );
      expect(result).toEqual(MOCK_JSON_API_LIST);
    });

    it("should filter by term when provided", async () => {
      // Arrange
      const term = "Admin";
      roleRepository.findForUser.mockResolvedValue([MOCK_ROLES[0]]);
      jsonApiService.buildList.mockResolvedValue({ data: [MOCK_JSON_API_LIST.data[0]] });

      // Act
      await service.findForUser({
        userId: TEST_IDS.userId,
        term,
        query: {},
      });

      // Assert
      expect(roleRepository.findForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          term,
        }),
      );
    });
  });

  describe("findNotInUser", () => {
    it("should find roles not assigned to a user", async () => {
      // Arrange
      const query = {};
      roleRepository.findNotInUser.mockResolvedValue(MOCK_ROLES);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_LIST);

      // Act
      const result = await service.findNotInUser({
        userId: TEST_IDS.userId,
        term: "",
        query,
      });

      // Assert
      expect(roleRepository.findNotInUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          term: "",
        }),
      );
      expect(result).toEqual(MOCK_JSON_API_LIST);
    });
  });

  describe("create", () => {
    const createData = {
      id: TEST_IDS.roleId,
      attributes: {
        name: "New Role",
        description: "A new role",
      },
    };

    it("should create a new role", async () => {
      // Arrange
      roleRepository.create.mockResolvedValue(undefined);
      roleRepository.findById.mockResolvedValue(MOCK_ROLE);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_SINGLE);

      // Act
      const result = await service.create({ data: createData as any });

      // Assert
      expect(roleRepository.create).toHaveBeenCalledWith({
        id: createData.id,
        name: createData.attributes.name,
        description: createData.attributes.description,
      });
      expect(result).toEqual(MOCK_JSON_API_SINGLE);
    });

    it("should return the created role", async () => {
      // Arrange
      roleRepository.create.mockResolvedValue(undefined);
      roleRepository.findById.mockResolvedValue({ ...MOCK_ROLE, name: "New Role" });
      jsonApiService.buildSingle.mockResolvedValue({
        data: { type: "roles", id: TEST_IDS.roleId, attributes: { name: "New Role" } },
      });

      // Act
      const result = await service.create({ data: createData as any });

      // Assert
      expect(roleRepository.findById).toHaveBeenCalledWith({ roleId: createData.id });
      expect(result.data.attributes.name).toBe("New Role");
    });
  });

  describe("update", () => {
    const updateData = {
      id: TEST_IDS.roleId,
      attributes: {
        name: "Updated Role",
        description: "Updated description",
      },
    };

    it("should update an existing role", async () => {
      // Arrange
      roleRepository.findByNameNotId.mockResolvedValue(null);
      roleRepository.update.mockResolvedValue(undefined);
      roleRepository.findById.mockResolvedValue({ ...MOCK_ROLE, ...updateData.attributes });
      jsonApiService.buildSingle.mockResolvedValue({
        data: { type: "roles", id: TEST_IDS.roleId, attributes: updateData.attributes },
      });

      // Act
      const result = await service.update({ data: updateData as any });

      // Assert
      expect(roleRepository.findByNameNotId).toHaveBeenCalledWith({
        roleId: updateData.id,
        name: updateData.attributes.name,
      });
      expect(roleRepository.update).toHaveBeenCalledWith({
        id: updateData.id,
        name: updateData.attributes.name,
        description: updateData.attributes.description,
      });
      expect(result.data.attributes.name).toBe("Updated Role");
    });

    it("should throw CONFLICT when name is taken by another role", async () => {
      // Arrange
      const existingRole: Role = { ...MOCK_ROLE, id: "other-role-id", name: "Updated Role" };
      roleRepository.findByNameNotId.mockResolvedValue(existingRole);

      // Act & Assert
      await expect(service.update({ data: updateData as any })).rejects.toThrow(
        new HttpException("A role with the given name already exists", HttpStatus.CONFLICT),
      );
      expect(roleRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete a role", async () => {
      // Arrange
      roleRepository.delete.mockResolvedValue(undefined);

      // Act
      await service.delete({ roleId: TEST_IDS.roleId });

      // Assert
      expect(roleRepository.delete).toHaveBeenCalledWith({ roleId: TEST_IDS.roleId });
    });
  });
});
