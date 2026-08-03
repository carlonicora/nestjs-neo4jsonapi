import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { GoogleUserRepository } from "../google-user.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { GoogleUser, GoogleUserDescriptor } from "../../entities/google-user";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  googleUserId: "770e8400-e29b-41d4-a716-446655440002",
  googleId: "118234567890123456789",
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

describe("GoogleUserRepository", () => {
  let repository: GoogleUserRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  let clsService: ReturnType<typeof createMockClsService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_GOOGLE_USER: GoogleUser = {
    id: TEST_IDS.googleUserId,
    name: "Test Google User",
    googleId: TEST_IDS.googleId,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as GoogleUser;

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
        GoogleUserRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: SecurityService, useValue: securityService },
        { provide: ClsService, useValue: clsService },
      ],
    }).compile();

    repository = module.get<GoogleUserRepository>(GoogleUserRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findByGoogleId", () => {
    it("should find google user by googleId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_GOOGLE_USER);

      const result = await repository.findByGoogleId({ googleId: TEST_IDS.googleId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: GoogleUserDescriptor.model,
      });
      expect(mockQuery.queryParams.googleId).toBe(TEST_IDS.googleId);
      expect(mockQuery.query).toContain("googleId: $googleId");
      expect(mockQuery.query).toContain(":GoogleUser");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_GOOGLE_USER);
    });

    it("should return null when google user not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByGoogleId({ googleId: "nonexistent" });

      expect(result).toBeNull();
    });

    it("should include proper return statement with relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_GOOGLE_USER);

      await repository.findByGoogleId({ googleId: TEST_IDS.googleId });

      // Check return statement includes company and user relationships
      expect(mockQuery.query).toContain("googleuser_company");
      expect(mockQuery.query).toContain("googleuser_user");
      expect(mockQuery.query).toContain(":BELONGS_TO");
      expect(mockQuery.query).toContain(":HAS_GOOGLE");
    });

    it("should handle errors from neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockRejectedValue(new Error("Database error"));

      await expect(repository.findByGoogleId({ googleId: TEST_IDS.googleId })).rejects.toThrow("Database error");
    });
  });

  describe("inherited methods from AbstractRepository", () => {
    describe("find", () => {
      it("should find google users with default ordering", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.readMany.mockResolvedValue([MOCK_GOOGLE_USER]);

        const result = await repository.find({});

        expect(neo4jService.initQuery).toHaveBeenCalled();
        expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
        expect(result).toEqual([MOCK_GOOGLE_USER]);
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
    });

    describe("findById", () => {
      it("should find google user by ID", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.readOne.mockResolvedValue(MOCK_GOOGLE_USER);

        const result = await repository.findById({ id: TEST_IDS.googleUserId });

        expect(mockQuery.queryParams.searchValue).toBe(TEST_IDS.googleUserId);
        expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
        expect(result).toEqual(MOCK_GOOGLE_USER);
      });
    });

    describe("create", () => {
      it("should create a google user", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(undefined);
        neo4jService.validateExistingNodes.mockResolvedValue(undefined);

        await repository.create({
          id: TEST_IDS.googleUserId,
          name: "New Google User",
          googleId: TEST_IDS.googleId,
          user: TEST_IDS.userId,
        });

        expect(neo4jService.writeOne).toHaveBeenCalled();
        expect(mockQuery.query).toContain("CREATE");
        expect(mockQuery.query).toContain(":GoogleUser");
      });
    });

    describe("delete", () => {
      it("should delete a google user", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(undefined);

        await repository.delete({ id: TEST_IDS.googleUserId });

        expect(mockQuery.queryParams.id).toBe(TEST_IDS.googleUserId);
        expect(mockQuery.query).toContain("DETACH DELETE");
        expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      });
    });
  });

  describe("buildReturnStatement", () => {
    it("should build proper return statement with relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_GOOGLE_USER);

      await repository.findByGoogleId({ googleId: TEST_IDS.googleId });

      // The return statement should include:
      // - googleuser
      // - googleuser_company (via BELONGS_TO)
      // - googleuser_user (via HAS_GOOGLE)
      // - googleuser_user_company (aliased)
      // - Role relationship (optional)
      expect(mockQuery.query).toContain("RETURN googleuser");
      expect(mockQuery.query).toContain("googleuser_company");
      expect(mockQuery.query).toContain("googleuser_user");
      expect(mockQuery.query).toContain(":HAS_MEMBERSHIP");
      expect(mockQuery.query).toContain(":IN_COMPANY");
      expect(mockQuery.query).toContain(":HAS_ROLE");
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values for googleUserId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_GOOGLE_USER);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findById({ id: exactId });

      expect(mockQuery.queryParams.searchValue).toBe(exactId);
    });

    it("should handle google IDs with different formats", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      // Google IDs are typically numeric strings
      const numericGoogleId = "987654321098765432123";
      await repository.findByGoogleId({ googleId: numericGoogleId });

      expect(mockQuery.queryParams.googleId).toBe(numericGoogleId);
    });

    it("should handle special characters in name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);

      const specialName = "User with 'quotes' and \"double quotes\"";
      await repository.create({
        id: TEST_IDS.googleUserId,
        name: specialName,
        googleId: TEST_IDS.googleId,
        user: TEST_IDS.userId,
      });

      expect(mockQuery.queryParams.name).toBe(specialName);
    });
  });
});
