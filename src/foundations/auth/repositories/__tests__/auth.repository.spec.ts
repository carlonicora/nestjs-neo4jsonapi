import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthRepository } from "../auth.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { Auth } from "../../entities/auth.entity";
import { AuthCode } from "../../entities/auth.code.entity";

// Mock crypto.randomUUID
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "mocked-uuid-12345"),
}));

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  authId: "770e8400-e29b-41d4-a716-446655440002",
  authCodeId: "880e8400-e29b-41d4-a716-446655440003",
  roleId: "990e8400-e29b-41d4-a716-446655440004",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  read: vi.fn(),
  initQuery: vi.fn(),
});

const createMockSecurityService = () => ({
  refreshTokenExpiration: new Date("2025-02-01T00:00:00Z"),
  tokenExpiration: new Date("2025-01-02T00:00:00Z"),
});

describe("AuthRepository", () => {
  let repository: AuthRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let securityService: ReturnType<typeof createMockSecurityService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_USER = {
    id: TEST_IDS.userId,
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    language: "en",
    company: {
      id: TEST_IDS.companyId,
      name: "Test Company",
    },
    role: [{ id: TEST_IDS.roleId, name: "User" }],
  };

  const MOCK_AUTH: Auth = {
    id: TEST_IDS.authId,
    token: "test-token-12345",
    expiration: new Date("2025-01-15T00:00:00Z"),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    user: MOCK_USER as any,
  };

  const MOCK_AUTH_CODE: AuthCode = {
    id: TEST_IDS.authCodeId,
    expiration: new Date("2025-01-02T00:00:00Z"),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    auth: MOCK_AUTH,
  };

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    securityService = createMockSecurityService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: SecurityService, useValue: securityService },
      ],
    }).compile();

    repository = module.get<AuthRepository>(AuthRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on AuthCode id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: "CREATE CONSTRAINT authcode_id IF NOT EXISTS FOR (authcode:AuthCode) REQUIRE authcode.id IS UNIQUE",
      });
    });

    it("should create unique constraint on Auth id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: "CREATE CONSTRAINT auth_id IF NOT EXISTS FOR (auth:Auth) REQUIRE auth.id IS UNIQUE",
      });
    });

    it("should create both constraints", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should handle constraint creation errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("setLastLogin", () => {
    it("should update user last login timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.setLastLogin({ userId: TEST_IDS.userId });

      expect(mockQuery.queryParams).toMatchObject({
        userId: TEST_IDS.userId,
      });
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("SET user.lastLogin = datetime()");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.setLastLogin({ userId: TEST_IDS.userId })).rejects.toThrow("Update failed");
    });
  });

  describe("findByCode", () => {
    it("should find auth code successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_AUTH_CODE);

      const result = await repository.findByCode({ code: TEST_IDS.authCodeId });

      expect(mockQuery.queryParams).toMatchObject({
        authCodeId: TEST_IDS.authCodeId,
      });
      expect(mockQuery.query).toContain("MATCH (authcode:AuthCode {id: $authCodeId})");
      expect(mockQuery.query).toContain("<-[:HAS_AUTH_CODE]-(authcode_auth:Auth)");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_AUTH_CODE);
    });

    it("should return null when code not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByCode({ code: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("should find auth by ID with all relationships", async () => {
      const firstQuery = createMockQuery();
      const secondQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(firstQuery).mockReturnValueOnce(secondQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_AUTH);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findById({ authId: TEST_IDS.authId });

      expect(firstQuery.queryParams).toMatchObject({
        authId: TEST_IDS.authId,
      });
      expect(firstQuery.query).toContain("MATCH (auth:Auth {id: $authId})");
      expect(firstQuery.query).toContain("MATCH (auth)<-[:HAS_AUTH]-(auth_user:User)");
      expect(firstQuery.query).toContain(
        "OPTIONAL MATCH (auth_user)-[:HAS_MEMBERSHIP]->(auth_user_role_ms:Membership)",
      );
      // Alias-bound (NOT $companyId): the auth-code exchange runs unauthenticated,
      // so the membership read is pinned to the company on the same row.
      expect(firstQuery.query).toContain("(auth_user_role_ms)-[:IN_COMPANY]->(auth_user_company)");
      expect(firstQuery.query).not.toContain("(auth_user_role_ms)-[:IN_COMPANY]->(:Company {id: $companyId})");
      expect(firstQuery.query).toContain("OPTIONAL MATCH (auth_user_role_ms)-[:HAS_ROLE]->(auth_user_role:Role)");
      expect(result).toBeDefined();
    });

    it("should return null when auth not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      await expect(repository.findById({ authId: "nonexistent" })).rejects.toThrow();
    });
  });

  describe("deleteByCode", () => {
    it("should delete auth code", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteByCode({ code: TEST_IDS.authCodeId });

      expect(mockQuery.queryParams).toMatchObject({
        authCodeId: TEST_IDS.authCodeId,
      });
      expect(mockQuery.query).toContain("MATCH (authcode:AuthCode {id: $authCodeId})");
      expect(mockQuery.query).toContain("DETACH DELETE authcode");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("deleteByToken", () => {
    it("should delete auth by token", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteByToken({ token: "test-token" });

      expect(mockQuery.queryParams).toMatchObject({
        token: "test-token",
      });
      expect(mockQuery.query).toContain("MATCH (auth:Auth {token: $token})");
      expect(mockQuery.query).toContain("DETACH DELETE auth");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("createCode", () => {
    it("should create auth code successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const expiration = new Date("2025-01-02T00:00:00Z");
      await repository.createCode({
        authCodeId: TEST_IDS.authCodeId,
        authId: TEST_IDS.authId,
        expiration,
      });

      expect(mockQuery.queryParams).toMatchObject({
        authCodeId: TEST_IDS.authCodeId,
        authId: TEST_IDS.authId,
        expiration: expiration.toISOString(),
      });
      expect(mockQuery.query).toContain("MATCH (auth:Auth {id: $authId})");
      expect(mockQuery.query).toContain("CREATE (authcode:AuthCode");
      expect(mockQuery.query).toContain("id: $authCodeId");
      expect(mockQuery.query).toContain("MERGE (auth)-[:HAS_AUTH_CODE]->(authcode)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("refreshToken", () => {
    it("should refresh auth token", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_AUTH);

      const result = await repository.refreshToken({
        authId: TEST_IDS.authId,
        token: "new-token",
      });

      expect(mockQuery.queryParams).toMatchObject({
        authId: TEST_IDS.authId,
        token: "new-token",
      });
      expect(mockQuery.query).toContain("MATCH (auth:Auth {id: $authId})");
      expect(mockQuery.query).toContain("SET auth.token = $token");
      expect(mockQuery.query).toContain("auth.expiration = datetime($expiration)");
      expect(result).toEqual(MOCK_AUTH);
    });
  });

  describe("findByRefreshToken", () => {
    it("should find auth by refresh token (authId)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_AUTH);

      const result = await repository.findByRefreshToken({ authId: TEST_IDS.authId });

      expect(mockQuery.queryParams).toMatchObject({
        authId: TEST_IDS.authId,
      });
      expect(mockQuery.query).toContain("MATCH (auth:Auth {id: $authId})<-[:HAS_AUTH]-(auth_user:User)");
      expect(result).toEqual(MOCK_AUTH);
    });
  });

  describe("findValidToken", () => {
    it("should find valid token by user ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_AUTH);

      const result = await repository.findValidToken({ userId: TEST_IDS.userId });

      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.query).toContain("MATCH (auth:Auth {userId: $userId");
      expect(result).toEqual(MOCK_AUTH);
    });
  });

  describe("findUserById", () => {
    it("should find user by ID with roles and company", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_USER);

      const result = await repository.findUserById({ userId: TEST_IDS.userId });

      expect(mockQuery.queryParams).toMatchObject({
        userId: TEST_IDS.userId,
      });
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("OPTIONAL MATCH (user)-[:HAS_MEMBERSHIP]->(user_role_ms:Membership)");
      expect(mockQuery.query).toContain("OPTIONAL MATCH (user_role_ms)-[:HAS_ROLE]->(user_role:Role)");
      expect(mockQuery.query).toContain("OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company)");
      expect(result).toEqual(MOCK_USER);
    });

    it("should resolve platform memberships alongside the active company's memberships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_USER);

      await repository.findUserById({ userId: TEST_IDS.userId });

      expect(mockQuery.query).toContain("(user_role_ms)-[:IN_COMPANY]->(:Company {id: $companyId})");
      expect(mockQuery.query).toContain("NOT (user_role_ms)-[:IN_COMPANY]->(:Company)");
    });

    it("should scope company and roles to an explicit companyId when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_USER);

      await repository.findUserById({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId });

      expect(mockQuery.queryParams).toMatchObject({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
      });
      expect(mockQuery.query).toContain("OPTIONAL MATCH (user)-[:BELONGS_TO]->(user_company:Company {id: $companyId})");
    });
  });

  describe("findByToken", () => {
    it("should find auth by token with all relationships", async () => {
      const firstQuery = createMockQuery();
      const secondQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(firstQuery).mockReturnValueOnce(secondQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_AUTH);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByToken({ token: "test-token" });

      expect(firstQuery.queryParams).toMatchObject({
        token: "test-token",
      });
      expect(firstQuery.query).toContain("MATCH (auth:Auth {token: $token})<-[:HAS_AUTH]-(auth_user:User)");
      expect(result).toBeDefined();
    });
  });

  describe("deleteById", () => {
    it("should delete auth by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteById({ authId: TEST_IDS.authId });

      expect(mockQuery.queryParams).toMatchObject({
        authId: TEST_IDS.authId,
      });
      expect(mockQuery.query).toContain("MATCH (auth:Auth {id: $authId})");
      expect(mockQuery.query).toContain("DELETE auth");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("startResetPassword", () => {
    it("should set reset password code on user", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USER);

      const result = await repository.startResetPassword({ userId: TEST_IDS.userId });

      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.queryParams.code).toBe("mocked-uuid-12345");
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("SET user.code = $code");
      expect(mockQuery.query).toContain("user.codeExpiration = datetime($codeExpiration)");
      expect(result).toEqual(MOCK_USER);
    });
  });

  describe("resetPassword", () => {
    it("should reset user password and clear code", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.resetPassword({
        userId: TEST_IDS.userId,
        password: "new-hashed-password",
      });

      expect(mockQuery.queryParams).toMatchObject({
        userId: TEST_IDS.userId,
        password: "new-hashed-password",
      });
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("SET user.password = $password");
      expect(mockQuery.query).toContain("user.code = null");
      expect(mockQuery.query).toContain("user.codeExpiration = null");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("acceptInvitation", () => {
    it("should accept invitation and set user password", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.acceptInvitation({
        userId: TEST_IDS.userId,
        password: "new-password",
      });

      expect(mockQuery.queryParams).toMatchObject({
        userId: TEST_IDS.userId,
        password: "new-password",
      });
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("SET user.password = $password");
      expect(mockQuery.query).toContain("user.isActive = true");
      expect(mockQuery.query).toContain("user.isDeleted = false");
      expect(mockQuery.query).toContain("user.code = null");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("activateAccount", () => {
    it("should activate user account", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.activateAccount({ userId: TEST_IDS.userId });

      expect(mockQuery.queryParams).toMatchObject({
        userId: TEST_IDS.userId,
      });
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("SET user.isActive = true");
      expect(mockQuery.query).toContain("user.code = null");
      expect(mockQuery.query).toContain("user.codeExpiration = null");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("deleteExpiredAuths", () => {
    it("should delete expired auth tokens for user", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteExpiredAuths({ userId: TEST_IDS.userId });

      expect(mockQuery.queryParams).toMatchObject({
        userId: TEST_IDS.userId,
      });
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("MATCH (user)-[:HAS_AUTH]->(auth:Auth)");
      expect(mockQuery.query).toContain("WHERE auth.expiration < datetime()");
      expect(mockQuery.query).toContain("DETACH DELETE auth");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_AUTH);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findByRefreshToken({ authId: exactId });

      expect(mockQuery.queryParams.authId).toBe(exactId);
    });

    it("should handle long tokens", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const longToken = "a".repeat(500);
      await repository.deleteByToken({ token: longToken });

      expect(mockQuery.queryParams.token).toBe(longToken);
    });
  });

  describe("countUserCompanies", () => {
    it("should count the companies the user belongs to", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({
        records: [{ get: () => ({ toNumber: () => 2 }) }],
      } as any);

      const result = await repository.countUserCompanies({ userId: TEST_IDS.userId });

      expect(result).toBe(2);
      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company:Company)");
      expect(mockQuery.query).toContain("count(DISTINCT company) AS total");
    });

    it("should return 0 when the user belongs to no company", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] } as any);

      const result = await repository.countUserCompanies({ userId: TEST_IDS.userId });

      expect(result).toBe(0);
    });
  });

  describe("findUserCompanies", () => {
    it("should list the companies the user belongs to, ordered by name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([{ id: "company-a" }, { id: "company-b" }] as any);

      const result = await repository.findUserCompanies({ userId: TEST_IDS.userId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({ serialiser: expect.anything(), fetchAll: true }),
      );
      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.query).toContain("MATCH (:User {id: $userId})-[:BELONGS_TO]->(company:Company)");
      expect(mockQuery.query).toContain("ORDER BY company.name");
      expect(result).toHaveLength(2);
    });
  });

  describe("Service Integration", () => {
    it("should use SecurityService for token expiration", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_AUTH);

      await repository.refreshToken({
        authId: TEST_IDS.authId,
        token: "new-token",
      });

      expect(mockQuery.queryParams.expiration).toBe(securityService.refreshTokenExpiration.toISOString());
    });
  });
});
