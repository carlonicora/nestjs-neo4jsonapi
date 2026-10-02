import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { OAuthRepository } from "../oauth.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { CompanyDescriptor } from "../../../company/entities/company";

// Test IDs
const TEST_IDS = {
  userId: "550e8400-e29b-41d4-a716-446655440000",
  companyId: "660e8400-e29b-41d4-a716-446655440001",
  clientId: "770e8400-e29b-41d4-a716-446655440002",
  accessTokenId: "880e8400-e29b-41d4-a716-446655440003",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  read: vi.fn(),
  initQuery: vi.fn(),
});

describe("OAuthRepository", () => {
  let repository: OAuthRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_CLIENT = {
    id: TEST_IDS.clientId,
    clientId: "client-uuid",
    name: "Test Client",
    isConfidential: true,
    isActive: true,
  };

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [OAuthRepository, { provide: Neo4jService, useValue: neo4jService }],
    }).compile();

    repository = module.get<OAuthRepository>(OAuthRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create all constraints and indexes", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      // Should create 5 constraints and 3 indexes = 8 calls
      expect(neo4jService.writeOne).toHaveBeenCalledTimes(8);
    });

    it("should create client constraints", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: "CREATE CONSTRAINT oauth_client_id IF NOT EXISTS FOR (c:OAuthClient) REQUIRE c.id IS UNIQUE",
      });
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: "CREATE CONSTRAINT oauth_client_clientid IF NOT EXISTS FOR (c:OAuthClient) REQUIRE c.clientId IS UNIQUE",
      });
    });

    it("should create token constraints", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query:
          "CREATE CONSTRAINT oauth_access_token_hash IF NOT EXISTS FOR (t:OAuthAccessToken) REQUIRE t.tokenHash IS UNIQUE",
      });
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query:
          "CREATE CONSTRAINT oauth_refresh_token_hash IF NOT EXISTS FOR (t:OAuthRefreshToken) REQUIRE t.tokenHash IS UNIQUE",
      });
    });

    it("should handle errors", async () => {
      neo4jService.writeOne.mockRejectedValue(new Error("Constraint creation failed"));

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("createClient", () => {
    it("should create confidential client with secret", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_CLIENT);

      const result = await repository.createClient({
        name: "Test Client",
        redirectUris: ["https://example.com/callback"],
        allowedScopes: ["read", "write"],
        allowedGrantTypes: ["authorization_code"],
        isConfidential: true,
        ownerId: TEST_IDS.userId,
      });

      expect(result.client).toEqual(MOCK_CLIENT);
      expect(result.clientSecret).toBeDefined();
      expect(mockQuery.queryParams.name).toBe("Test Client");
      expect(mockQuery.queryParams.isConfidential).toBe(true);
    });

    it("should create public client without secret", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_CLIENT);

      const result = await repository.createClient({
        name: "Public Client",
        redirectUris: ["https://example.com/callback"],
        allowedScopes: ["read"],
        allowedGrantTypes: ["authorization_code"],
        isConfidential: false,
        ownerId: TEST_IDS.userId,
      });

      expect(result.clientSecret).toBeUndefined();
      expect(mockQuery.queryParams.clientSecretHash).toBeNull();
    });

    it("should create client with company relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_CLIENT);

      await repository.createClient({
        name: "Company Client",
        redirectUris: ["https://example.com/callback"],
        allowedScopes: ["read"],
        allowedGrantTypes: ["authorization_code"],
        isConfidential: true,
        ownerId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
      });

      expect(mockQuery.queryParams.companyId).toBe(TEST_IDS.companyId);
      expect(mockQuery.query).toContain("HAS_OAUTH_CLIENT");
    });
  });

  describe("findClientByClientId", () => {
    it("should find client by clientId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_CLIENT);

      const result = await repository.findClientByClientId("client-uuid");

      expect(mockQuery.queryParams.clientId).toBe("client-uuid");
      expect(result).toEqual(MOCK_CLIENT);
    });

    it("should return null when client not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockRejectedValue(new Error("Not found"));

      const result = await repository.findClientByClientId("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findClientById", () => {
    it("should find client by id", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_CLIENT);

      const result = await repository.findClientById(TEST_IDS.clientId);

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.clientId);
      expect(result).toEqual(MOCK_CLIENT);
    });
  });

  describe("findClientsByOwnerId", () => {
    it("should find all clients owned by user", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CLIENT]);

      const result = await repository.findClientsByOwnerId(TEST_IDS.userId);

      expect(mockQuery.queryParams.ownerId).toBe(TEST_IDS.userId);
      expect(mockQuery.query).toContain(":OWNS_CLIENT");
      expect(result).toEqual([MOCK_CLIENT]);
    });
  });

  describe("updateClient", () => {
    it("should update client properties", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_CLIENT);

      const result = await repository.updateClient("client-uuid", {
        name: "Updated Name",
        isActive: false,
      });

      expect(mockQuery.queryParams.clientId).toBe("client-uuid");
      expect(mockQuery.queryParams.name).toBe("Updated Name");
      expect(mockQuery.queryParams.isActive).toBe(false);
      expect(result).toEqual(MOCK_CLIENT);
    });
  });

  describe("regenerateClientSecret", () => {
    it("should regenerate client secret", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const result = await repository.regenerateClientSecret("client-uuid");

      expect(result.clientSecret).toBeDefined();
      expect(mockQuery.queryParams.clientId).toBe("client-uuid");
      expect(mockQuery.queryParams.clientSecretHash).toBeDefined();
    });
  });

  describe("deleteClient", () => {
    it("should delete client and related tokens", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteClient("client-uuid");

      expect(mockQuery.queryParams.clientId).toBe("client-uuid");
      expect(mockQuery.query).toContain("DETACH DELETE c, code, at, rt");
    });
  });

  describe("createAuthorizationCode", () => {
    it("should create authorization code", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createAuthorizationCode({
        code: "auth-code-123",
        clientId: "client-uuid",
        userId: TEST_IDS.userId,
        redirectUri: "https://example.com/callback",
        scope: "read write",
        expiresAt: new Date("2025-01-01T00:10:00Z"),
      });

      expect(mockQuery.queryParams.clientId).toBe("client-uuid");
      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.queryParams.redirectUri).toBe("https://example.com/callback");
      expect(mockQuery.queryParams.codeHash).toBeDefined();
      expect(mockQuery.query).toContain(":ISSUED_CODE");
    });

    it("should include PKCE parameters when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createAuthorizationCode({
        code: "auth-code-123",
        clientId: "client-uuid",
        userId: TEST_IDS.userId,
        redirectUri: "https://example.com/callback",
        scope: "read",
        codeChallenge: "challenge123",
        codeChallengeMethod: "S256",
        expiresAt: new Date("2025-01-01T00:10:00Z"),
      });

      expect(mockQuery.queryParams.codeChallenge).toBe("challenge123");
      expect(mockQuery.queryParams.codeChallengeMethod).toBe("S256");
    });
  });

  describe("findAuthorizationCodeByHash", () => {
    it("should find authorization code by hash", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue({ id: "code-id", codeHash: "hash123" });

      const result = await repository.findAuthorizationCodeByHash("hash123");

      expect(mockQuery.queryParams.codeHash).toBe("hash123");
      expect(result).toBeDefined();
    });

    it("should return null when code not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockRejectedValue(new Error("Not found"));

      const result = await repository.findAuthorizationCodeByHash("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("markAuthorizationCodeUsed", () => {
    it("should mark code as used and return true", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue({ id: "code-id" });

      const result = await repository.markAuthorizationCodeUsed("hash123");

      expect(result).toBe(true);
      expect(mockQuery.query).toContain("SET code.isUsed = true");
    });

    it("should return false when code already used", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockRejectedValue(new Error("Code already used"));

      const result = await repository.markAuthorizationCodeUsed("hash123");

      expect(result).toBe(false);
    });
  });

  describe("createAccessToken", () => {
    it("should create access token", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const result = await repository.createAccessToken({
        token: "access-token-123",
        clientId: "client-uuid",
        userId: TEST_IDS.userId,
        scope: "read write",
        grantType: "authorization_code",
        expiresAt: new Date("2025-01-01T01:00:00Z"),
      });

      expect(result).toBeDefined(); // Returns token ID
      expect(mockQuery.queryParams.tokenHash).toBeDefined();
      expect(mockQuery.query).toContain(":ISSUED_ACCESS_TOKEN");
    });

    it("should create token without user (client credentials grant)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createAccessToken({
        token: "access-token-123",
        clientId: "client-uuid",
        scope: "read",
        grantType: "client_credentials",
        expiresAt: new Date("2025-01-01T01:00:00Z"),
      });

      expect(mockQuery.queryParams.userId).toBeNull();
    });
  });

  describe("revokeAccessToken", () => {
    it("should revoke access token", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.revokeAccessToken("token-hash-123");

      expect(mockQuery.queryParams.tokenHash).toBe("token-hash-123");
      expect(mockQuery.query).toContain("SET token.isRevoked = true");
    });
  });

  describe("createRefreshToken", () => {
    it("should create refresh token linked to access token", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const result = await repository.createRefreshToken({
        token: "refresh-token-123",
        clientId: "client-uuid",
        userId: TEST_IDS.userId,
        scope: "read write",
        accessTokenId: TEST_IDS.accessTokenId,
        expiresAt: new Date("2025-01-08T00:00:00Z"),
      });

      expect(result).toBeDefined();
      expect(mockQuery.queryParams.accessTokenId).toBe(TEST_IDS.accessTokenId);
      expect(mockQuery.query).toContain(":LINKED_REFRESH");
    });
  });

  describe("revokeAllUserTokensForClient", () => {
    it("should revoke all tokens for user and client", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.revokeAllUserTokensForClient(TEST_IDS.userId, "client-uuid");

      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.queryParams.clientId).toBe("client-uuid");
      expect(mockQuery.query).toContain("at.isRevoked = true");
      expect(mockQuery.query).toContain("rt.isRevoked = true");
    });
  });

  describe("findCompanyIdForUser", () => {
    it("reads the user's company through readOne with the Company serialiser and returns its id", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue({ id: TEST_IDS.companyId, name: "Studio" });

      const result = await repository.findCompanyIdForUser(TEST_IDS.userId);

      expect(result).toBe(TEST_IDS.companyId);
      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: CompanyDescriptor.model });
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(neo4jService.read).not.toHaveBeenCalled();
      expect(mockQuery.queryParams).toEqual(expect.objectContaining({ userId: TEST_IDS.userId }));
      expect(mockQuery.query).toContain("MATCH (oauthUser:User {id: $userId})-[:BELONGS_TO]->(company:Company)");
      expect(mockQuery.query).toContain("RETURN company");
    });

    it("should return null when user has no company", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findCompanyIdForUser(TEST_IDS.userId);

      expect(result).toBeNull();
    });

    it("should return null on error", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.readOne.mockRejectedValue(new Error("Database error"));

      const result = await repository.findCompanyIdForUser(TEST_IDS.userId);

      expect(result).toBeNull();
    });
  });

  describe("findCompaniesForUser", () => {
    it("reads the user's companies through readMany with the Company serialiser, ordered by name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([
        { id: "c1", name: "Alpha", ownerEmail: "x" },
        { id: "c2", name: "Beta" },
      ]);

      const result = await repository.findCompaniesForUser(TEST_IDS.userId);

      expect(result).toEqual([
        { id: "c1", name: "Alpha" },
        { id: "c2", name: "Beta" },
      ]);
      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({ serialiser: expect.objectContaining({ nodeName: "company" }), fetchAll: true }),
      );
      expect(neo4jService.read).not.toHaveBeenCalled();
      expect(mockQuery.query).toContain("MATCH (oauthUser:User {id: $userId})-[:BELONGS_TO]->(company:Company)");
      expect(mockQuery.query).toContain("ORDER BY company.name");
      expect(mockQuery.query).toMatch(/RETURN company\s*$/);
      expect(mockQuery.queryParams).toEqual(expect.objectContaining({ userId: TEST_IDS.userId }));
    });

    it("returns [] when the read fails", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.readMany.mockRejectedValue(new Error("db"));

      expect(await repository.findCompaniesForUser(TEST_IDS.userId)).toEqual([]);
    });
  });

  describe("userBelongsToCompany", () => {
    it("reads the chosen company through readOne with the Company serialiser", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue({ id: TEST_IDS.companyId, name: "Alpha" });

      const result = await repository.userBelongsToCompany({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId });

      expect(result).toBe(true);
      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({ serialiser: expect.objectContaining({ nodeName: "company" }) }),
      );
      expect(neo4jService.read).not.toHaveBeenCalled();
      expect(mockQuery.query).toContain(
        "MATCH (oauthUser:User {id: $userId})-[:BELONGS_TO]->(company:Company {id: $chosenCompanyId})",
      );
      expect(mockQuery.queryParams).toEqual(
        expect.objectContaining({ userId: TEST_IDS.userId, chosenCompanyId: TEST_IDS.companyId }),
      );
    });

    it("refuses a company the user does not belong to", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.readOne.mockResolvedValue(null);

      expect(await repository.userBelongsToCompany({ userId: TEST_IDS.userId, companyId: "foreign" })).toBe(false);
    });

    it("refuses when the read fails", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.readOne.mockRejectedValue(new Error("db"));

      expect(await repository.userBelongsToCompany({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId })).toBe(
        false,
      );
    });
  });

  describe("deleteExpiredAuthorizationCodes", () => {
    it("should delete expired codes", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteExpiredAuthorizationCodes();

      expect(mockQuery.query).toContain("code.expiresAt < datetime()");
      expect(mockQuery.query).toContain("DETACH DELETE code");
    });
  });

  describe("deleteExpiredTokens", () => {
    it("should delete expired tokens", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteExpiredTokens();

      expect(mockQuery.query).toContain("at.expiresAt < datetime()");
      expect(mockQuery.query).toContain("DETACH DELETE at, rt");
    });
  });
});
