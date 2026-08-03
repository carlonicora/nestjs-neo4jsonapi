import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { DiscordUserRepository } from "../discord-user.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { DiscordUser, DiscordUserDescriptor } from "../../entities/discord-user";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  discordUserId: "770e8400-e29b-41d4-a716-446655440002",
  discordId: "123456789012345678",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  read: vi.fn(),
  initQuery: vi.fn(),
  validateExistingNodes: vi.fn(),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn(({ validator }: { validator: () => string }) => validator()),
  isCurrentUserCompanyAdmin: vi.fn().mockReturnValue(true),
});

const createMockClsService = () => ({
  has: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
});

describe("DiscordUserRepository", () => {
  let repository: DiscordUserRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  let clsService: ReturnType<typeof createMockClsService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_DISCORD_USER: DiscordUser = {
    id: TEST_IDS.discordUserId,
    name: "Test Discord User",
    discordId: TEST_IDS.discordId,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as DiscordUser;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    securityService = createMockSecurityService();
    clsService = createMockClsService();

    // Default CLS context
    clsService.get.mockImplementation((key: string) => {
      if (key === "companyId") return TEST_IDS.companyId;
      if (key === "userId") return TEST_IDS.userId;
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordUserRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: SecurityService, useValue: securityService },
        { provide: ClsService, useValue: clsService },
      ],
    }).compile();

    repository = module.get<DiscordUserRepository>(DiscordUserRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findByDiscordId", () => {
    it("should find discord user by discordId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_DISCORD_USER);

      const result = await repository.findByDiscordId({ discordId: TEST_IDS.discordId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: DiscordUserDescriptor.model,
      });
      expect(mockQuery.queryParams.discordId).toBe(TEST_IDS.discordId);
      expect(mockQuery.query).toContain("discordId: $discordId");
      expect(mockQuery.query).toContain(":DiscordUser");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_DISCORD_USER);
    });

    it("should return null when discord user not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByDiscordId({ discordId: "nonexistent" });

      expect(result).toBeNull();
    });

    it("should include proper return statement with relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_DISCORD_USER);

      await repository.findByDiscordId({ discordId: TEST_IDS.discordId });

      // Check return statement includes company and user relationships
      expect(mockQuery.query).toContain("discorduser_company");
      expect(mockQuery.query).toContain("discorduser_user");
      expect(mockQuery.query).toContain(":BELONGS_TO");
      expect(mockQuery.query).toContain(":HAS_DISCORD");
    });

    it("should handle errors from neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockRejectedValue(new Error("Database error"));

      await expect(repository.findByDiscordId({ discordId: TEST_IDS.discordId })).rejects.toThrow("Database error");
    });
  });

  describe("inherited methods from AbstractRepository", () => {
    describe("find", () => {
      it("should find discord users with default ordering", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.readMany.mockResolvedValue([MOCK_DISCORD_USER]);

        const result = await repository.find({});

        expect(neo4jService.initQuery).toHaveBeenCalled();
        expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
        expect(result).toEqual([MOCK_DISCORD_USER]);
      });

      it("should pass cursor and fetchAll options", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.readMany.mockResolvedValue([]);

        const cursor = { limit: 10, offset: 0 };
        await repository.find({ cursor, fetchAll: true });

        expect(neo4jService.initQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            cursor,
            fetchAll: true,
          }),
        );
      });

      it("should handle search term", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.readMany.mockResolvedValue([]);

        await repository.find({ term: "test" });

        expect(mockQuery.queryParams.term).toBe("*test*");
      });
    });

    describe("findById", () => {
      it("should find discord user by ID", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.readOne.mockResolvedValue(MOCK_DISCORD_USER);

        const result = await repository.findById({ id: TEST_IDS.discordUserId });

        expect(mockQuery.queryParams.searchValue).toBe(TEST_IDS.discordUserId);
        expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
        expect(result).toEqual(MOCK_DISCORD_USER);
      });
    });

    describe("create", () => {
      it("should create a discord user", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(undefined);
        neo4jService.validateExistingNodes.mockResolvedValue(undefined);

        await repository.create({
          id: TEST_IDS.discordUserId,
          name: "New Discord User",
          discordId: TEST_IDS.discordId,
          user: TEST_IDS.userId,
        });

        expect(neo4jService.writeOne).toHaveBeenCalled();
        expect(mockQuery.query).toContain("CREATE");
        expect(mockQuery.query).toContain(":DiscordUser");
      });
    });

    describe("delete", () => {
      it("should delete a discord user", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(undefined);

        await repository.delete({ id: TEST_IDS.discordUserId });

        expect(mockQuery.queryParams.id).toBe(TEST_IDS.discordUserId);
        expect(mockQuery.query).toContain("DETACH DELETE");
        expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      });
    });
  });

  describe("buildReturnStatement", () => {
    it("should build proper return statement with relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_DISCORD_USER);

      await repository.findByDiscordId({ discordId: TEST_IDS.discordId });

      // The return statement should include:
      // - discorduser
      // - discorduser_company (via BELONGS_TO)
      // - discorduser_user (via HAS_DISCORD)
      // - discorduser_user_company (aliased)
      // - Role relationship (optional)
      expect(mockQuery.query).toContain("RETURN discorduser");
      expect(mockQuery.query).toContain("discorduser_company");
      expect(mockQuery.query).toContain("discorduser_user");
      expect(mockQuery.query).toContain(":HAS_MEMBERSHIP");
      expect(mockQuery.query).toContain(":IN_COMPANY");
      expect(mockQuery.query).toContain(":HAS_ROLE");
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values for discordUserId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_DISCORD_USER);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findById({ id: exactId });

      expect(mockQuery.queryParams.searchValue).toBe(exactId);
    });

    it("should handle discord IDs with different formats", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      // Discord IDs are typically numeric strings
      const numericDiscordId = "987654321098765432";
      await repository.findByDiscordId({ discordId: numericDiscordId });

      expect(mockQuery.queryParams.discordId).toBe(numericDiscordId);
    });

    it("should handle special characters in name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      const specialName = "User with 'quotes' and \"double quotes\"";
      await repository.create({
        id: TEST_IDS.discordUserId,
        name: specialName,
        discordId: TEST_IDS.discordId,
        user: TEST_IDS.userId,
      });

      expect(mockQuery.queryParams.name).toBe(specialName);
    });
  });
});
