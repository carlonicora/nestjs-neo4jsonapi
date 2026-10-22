import { vi, describe, it, expect, beforeEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { UserRepository } from "../user.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { UserCypherService } from "../../services/user.cypher.service";

/**
 * A deleted user, or a user whose password changed, must lose every OAuth
 * (MCP) grant: the revocation runs inside the same write, so it only happens
 * when the write matched its user.
 */
describe("UserRepository OAuth token revocation", () => {
  let repository: UserRepository;
  let neo4j: Mocked<Neo4jService>;

  const USER_ID = "user-oauth-1";
  const COMPANY_ID = "company-oauth-1";

  const REVOKES_ACCESS =
    /MATCH \(revoked_access:OAuthAccessToken \{userId: user\.id\}\)\s*SET revoked_access\.isRevoked = true/;
  const REVOKES_REFRESH =
    /MATCH \(revoked_refresh:OAuthRefreshToken \{userId: user\.id\}\)\s*SET revoked_refresh\.isRevoked = true/;

  function writtenQuery(): string {
    return neo4j.writeOne.mock.calls[0][0].query;
  }

  beforeEach(async () => {
    neo4j = {
      initQuery: vi.fn().mockReturnValue({ query: "", queryParams: { companyId: COMPANY_ID } }),
      readOne: vi.fn(),
      readMany: vi.fn(),
      writeOne: vi.fn().mockResolvedValue(null),
      read: vi.fn(),
    } as unknown as Mocked<Neo4jService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        { provide: Neo4jService, useValue: neo4j },
        { provide: SecurityService, useValue: { userHasAccess: vi.fn().mockResolvedValue(true) } },
        { provide: ClsService, useValue: { get: vi.fn(), set: vi.fn(), has: vi.fn().mockReturnValue(false) } },
        { provide: UserCypherService, useValue: { default: vi.fn().mockReturnValue("") } },
      ],
    }).compile();

    repository = module.get(UserRepository);
  });

  describe("deleteUser", () => {
    it("revokes every access and refresh token of the user in the same query as the soft delete", async () => {
      await repository.deleteUser({ userId: USER_ID });

      const query = writtenQuery();
      expect(query).toContain("SET user.isDeleted = true");
      expect(query).toMatch(REVOKES_ACCESS);
      expect(query).toMatch(REVOKES_REFRESH);
      // Revocation follows the company-scoped match: a caller confined to another company revokes nothing.
      expect(query.indexOf("BELONGS_TO")).toBeLessThan(query.indexOf("OAuthAccessToken"));
    });

    it("revokes the tokens for a platform administrator's delete too", async () => {
      await repository.deleteUser({ userId: USER_ID, isPlatformAdmin: true });

      const query = writtenQuery();
      expect(query).toMatch(REVOKES_ACCESS);
      expect(query).toMatch(REVOKES_REFRESH);
    });

    it("revokes tokens of every company, not only the request company", async () => {
      await repository.deleteUser({ userId: USER_ID });

      expect(writtenQuery()).not.toMatch(/OAuth(Access|Refresh)Token \{[^}]*companyId/);
    });
  });

  describe("putUser", () => {
    const putParams = {
      isAdmin: true,
      userId: USER_ID,
      email: "user@test.com",
      name: "Name",
    };

    it("revokes every OAuth token when the password changes", async () => {
      await repository.putUser({ ...putParams, password: "new-hash", isSelf: false });

      const query = writtenQuery();
      expect(query).toContain("user.password = $password");
      expect(query).toMatch(REVOKES_ACCESS);
      expect(query).toMatch(REVOKES_REFRESH);
    });

    it("revokes on a self password change with no company in context", async () => {
      neo4j.initQuery.mockReturnValue({ query: "", queryParams: { companyId: null } } as never);

      await repository.putUser({ ...putParams, password: "new-hash", isSelf: true });

      const query = writtenQuery();
      expect(query).toMatch(/WITH user\s+CALL/);
      expect(query).toMatch(REVOKES_ACCESS);
    });

    it("carries the company into the role block after the revocation", async () => {
      await repository.putUser({ ...putParams, password: "new-hash", roles: ["role-1"], isSelf: false });

      const query = writtenQuery();
      expect(query).toMatch(/WITH user, company\s+CALL/);
      expect(query.indexOf("OAuthRefreshToken")).toBeLessThan(query.indexOf("IN_COMPANY"));
    });

    it("does not revoke when no password is set", async () => {
      await repository.putUser({ ...putParams, isSelf: false });

      expect(writtenQuery()).not.toContain("OAuthAccessToken");
    });

    it("does not revoke for an empty password (the stored one is kept)", async () => {
      await repository.putUser({ ...putParams, password: "", isSelf: false });

      expect(writtenQuery()).not.toContain("OAuthAccessToken");
    });
  });

  describe("revokeOAuthTokens", () => {
    it("revokes every access and refresh token of the user", async () => {
      await repository.revokeOAuthTokens({ userId: USER_ID });

      const { query, queryParams } = neo4j.writeOne.mock.calls[0][0];
      expect(query).toContain("MATCH (user:User {id: $userId})");
      expect(query).toMatch(REVOKES_ACCESS);
      expect(query).toMatch(REVOKES_REFRESH);
      expect(queryParams).toMatchObject({ userId: USER_ID });
    });
  });
});
