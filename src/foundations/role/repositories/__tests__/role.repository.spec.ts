import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { RoleRepository } from "../role.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { Role } from "../../entities/role";
import { RoleId } from "../../../../common/constants/system.roles";
import { JsonApiCursorInterface } from "../../../../core/jsonapi/interfaces/jsonapi.cursor.interface";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  roleId1: "770e8400-e29b-41d4-a716-446655440002",
  roleId2: "880e8400-e29b-41d4-a716-446655440003",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
});

describe("RoleRepository", () => {
  let repository: RoleRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_CURSOR: JsonApiCursorInterface = {
    limit: 10,
    offset: 0,
  };

  const MOCK_ROLE: Role = {
    id: TEST_IDS.roleId1,
    name: "Editor",
    description: "Can edit content",
    isSelectable: true,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as Role;

  const MOCK_ROLE_2: Role = {
    id: TEST_IDS.roleId2,
    name: "Viewer",
    description: "Can view content",
    isSelectable: true,
    createdAt: new Date("2025-01-02T00:00:00Z"),
    updatedAt: new Date("2025-01-02T00:00:00Z"),
  } as Role;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RoleRepository, { provide: Neo4jService, useValue: neo4jService }],
    }).compile();

    repository = module.get<RoleRepository>(RoleRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: "CREATE CONSTRAINT role_id IF NOT EXISTS FOR (role:Role) REQUIRE role.id IS UNIQUE",
      });
    });

    it("should handle errors", async () => {
      neo4jService.writeOne.mockRejectedValue(new Error("Constraint creation failed"));

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findByNameNotId", () => {
    it("should find role by name excluding specific id", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_ROLE);

      const result = await repository.findByNameNotId({
        roleId: TEST_IDS.roleId2,
        name: "Editor",
      });

      expect(mockQuery.queryParams.roleId).toBe(TEST_IDS.roleId2);
      expect(mockQuery.queryParams.name).toBe("Editor");
      expect(mockQuery.query).toContain("MATCH (role:Role {name: $name})");
      expect(mockQuery.query).toContain("WHERE role.id <> $roleId");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_ROLE);
    });

    it("should return null when no matching role found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByNameNotId({
        roleId: TEST_IDS.roleId1,
        name: "NonExistent",
      });

      expect(result).toBeNull();
    });
  });

  describe("findByName", () => {
    it("should find role by name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_ROLE);

      const result = await repository.findByName({ name: "Editor" });

      expect(mockQuery.queryParams.name).toBe("Editor");
      expect(mockQuery.query).toContain("MATCH (role:Role {name: $name})");
      expect(mockQuery.query).toContain("RETURN role");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_ROLE);
    });

    it("should return null when role not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByName({ name: "NonExistent" });

      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("should find role by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_ROLE);

      const result = await repository.findById({ roleId: TEST_IDS.roleId1 });

      expect(mockQuery.queryParams.roleId).toBe(TEST_IDS.roleId1);
      expect(mockQuery.query).toContain("MATCH (role:Role {id: $roleId})");
      expect(mockQuery.query).toContain("RETURN role");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_ROLE);
    });

    it("should return null when role not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ roleId: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("find", () => {
    it("should find all roles excluding Administrator", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ROLE, MOCK_ROLE_2]);

      const result = await repository.find({ cursor: MOCK_CURSOR });

      expect(mockQuery.queryParams.administratorsId).toBe(RoleId.Administrator);
      expect(mockQuery.query).toContain("MATCH (role:Role)");
      expect(mockQuery.query).toContain("WHERE role.id <> $administratorsId");
      expect(mockQuery.query).toContain("ORDER BY role.name ASC");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_ROLE, MOCK_ROLE_2]);
    });

    it("should filter by search term when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ROLE]);

      const result = await repository.find({ term: "Edit", cursor: MOCK_CURSOR });

      expect(mockQuery.queryParams.term).toBe("Edit");
      expect(mockQuery.query).toContain("toLower(role.name) CONTAINS toLower($term)");
      expect(result).toEqual([MOCK_ROLE]);
    });

    it("should return empty array when no roles found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.find({ cursor: MOCK_CURSOR });

      expect(result).toEqual([]);
    });
  });

  describe("findForUser", () => {
    it("should find roles for a specific user", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ROLE]);

      const result = await repository.findForUser({ userId: TEST_IDS.userId, cursor: MOCK_CURSOR });

      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.queryParams.administratorsId).toBe(RoleId.Administrator);
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("[:BELONGS_TO]->(company)");
      expect(mockQuery.query).toContain("(user)-[:HAS_MEMBERSHIP]->(role_ms:Membership)");
      expect(mockQuery.query).toContain("(role_ms)-[:IN_COMPANY]->(company)");
      expect(mockQuery.query).toContain("(role_ms)-[:HAS_ROLE]->(role:Role)");
      expect(mockQuery.query).toContain("WHERE role.id <> $administratorsId");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_ROLE]);
    });

    it("should filter by search term when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ROLE]);

      const result = await repository.findForUser({
        userId: TEST_IDS.userId,
        term: "Edit",
        cursor: MOCK_CURSOR,
      });

      expect(mockQuery.queryParams.term).toBe("Edit");
      expect(mockQuery.query).toContain("toLower(role.name) CONTAINS toLower($term)");
      expect(result).toEqual([MOCK_ROLE]);
    });

    it("should return empty array when user has no roles", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findForUser({ userId: TEST_IDS.userId, cursor: MOCK_CURSOR });

      expect(result).toEqual([]);
    });
  });

  describe("findNotInUser", () => {
    it("should find roles not assigned to user", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ROLE_2]);

      const result = await repository.findNotInUser({
        userId: TEST_IDS.userId,
        cursor: MOCK_CURSOR,
      });

      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.queryParams.administratorsId).toBe(RoleId.Administrator);
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("WHERE NOT EXISTS {");
      expect(mockQuery.query).toContain("(user)-[:HAS_MEMBERSHIP]->(nu_ms:Membership)-[:HAS_ROLE]->(role)");
      expect(mockQuery.query).toContain("(nu_ms)-[:IN_COMPANY]->(company)");
      expect(mockQuery.query).toContain("AND role.id <> $administratorsId");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_ROLE_2]);
    });

    it("should filter by search term when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ROLE_2]);

      const result = await repository.findNotInUser({
        userId: TEST_IDS.userId,
        term: "View",
        cursor: MOCK_CURSOR,
      });

      expect(mockQuery.queryParams.term).toBe("View");
      expect(mockQuery.query).toContain("toLower(role.name) CONTAINS toLower($term)");
      expect(result).toEqual([MOCK_ROLE_2]);
    });

    it("should return empty array when all roles are assigned", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findNotInUser({
        userId: TEST_IDS.userId,
        cursor: MOCK_CURSOR,
      });

      expect(result).toEqual([]);
    });
  });

  describe("create", () => {
    it("should create a new role", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.roleId1,
        name: "New Role",
        description: "A new role",
      });

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.roleId1);
      expect(mockQuery.queryParams.name).toBe("New Role");
      expect(mockQuery.queryParams.description).toBe("A new role");
      expect(mockQuery.query).toContain("CREATE (role:Role");
      expect(mockQuery.query).toContain("id: $id");
      expect(mockQuery.query).toContain("name: $name");
      expect(mockQuery.query).toContain("description: $description");
      expect(mockQuery.query).toContain("createdAt: datetime()");
      expect(mockQuery.query).toContain("updatedAt: datetime()");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should create role without description", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.roleId1,
        name: "New Role",
      });

      expect(mockQuery.queryParams.description).toBeUndefined();
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockRejectedValue(new Error("Creation failed"));

      await expect(
        repository.create({
          id: TEST_IDS.roleId1,
          name: "New Role",
        }),
      ).rejects.toThrow("Creation failed");
    });
  });

  describe("update", () => {
    it("should update an existing role", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.update({
        id: TEST_IDS.roleId1,
        name: "Updated Role",
        description: "Updated description",
      });

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.roleId1);
      expect(mockQuery.queryParams.name).toBe("Updated Role");
      expect(mockQuery.queryParams.description).toBe("Updated description");
      expect(mockQuery.query).toContain("MATCH (role:Role {id: $id})");
      expect(mockQuery.query).toContain("SET role.name = $name");
      expect(mockQuery.query).toContain("role.description = $description");
      expect(mockQuery.query).toContain("role.updatedAt = datetime()");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should update role with undefined description", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.update({
        id: TEST_IDS.roleId1,
        name: "Updated Role",
      });

      expect(mockQuery.queryParams.description).toBeUndefined();
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockRejectedValue(new Error("Update failed"));

      await expect(
        repository.update({
          id: TEST_IDS.roleId1,
          name: "Updated Role",
        }),
      ).rejects.toThrow("Update failed");
    });
  });

  describe("delete", () => {
    it("should delete a role", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ roleId: TEST_IDS.roleId1 });

      expect(mockQuery.queryParams.roleId).toBe(TEST_IDS.roleId1);
      expect(mockQuery.query).toContain("MATCH (role:Role {id: $roleId})");
      expect(mockQuery.query).toContain("DETACH DELETE role");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockRejectedValue(new Error("Delete failed"));

      await expect(repository.delete({ roleId: TEST_IDS.roleId1 })).rejects.toThrow("Delete failed");
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findById({ roleId: exactId });

      expect(mockQuery.queryParams.roleId).toBe(exactId);
    });

    it("should use correct Administrator role ID constant", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.find({ cursor: MOCK_CURSOR });

      expect(mockQuery.queryParams.administratorsId).toBe("53394cb8-1e87-11ef-8b48-bed54b8f8aba");
    });

    it("should pass fetchAll flag in findNotInUser", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findNotInUser({ userId: TEST_IDS.userId, cursor: MOCK_CURSOR });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          fetchAll: true,
        }),
      );
    });
  });
});
