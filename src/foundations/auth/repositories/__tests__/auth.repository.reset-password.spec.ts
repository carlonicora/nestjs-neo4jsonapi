import { vi, describe, it, expect, beforeEach, type Mocked } from "vitest";
import { ClsService } from "nestjs-cls";
import { AuthRepository } from "../auth.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";

/**
 * A password reset by email is a password change: every OAuth (MCP) grant of
 * the user ends, in the same query as the password write, so it fires only
 * when that write matched the user.
 */
describe("AuthRepository.resetPassword OAuth revocation", () => {
  let repository: AuthRepository;
  let neo4j: Mocked<Pick<Neo4jService, "initQuery" | "writeOne">>;

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn().mockReturnValue({ query: "", queryParams: {} }),
      writeOne: vi.fn().mockResolvedValue(null),
    } as unknown as Mocked<Pick<Neo4jService, "initQuery" | "writeOne">>;
    repository = new AuthRepository(
      neo4j as unknown as Neo4jService,
      {} as SecurityService,
      { get: vi.fn(), set: vi.fn(), has: vi.fn().mockReturnValue(false) } as unknown as ClsService,
    );
  });

  it("revokes every access and refresh token of the user after the password write", async () => {
    await repository.resetPassword({ userId: "user-1", password: "new-hash" });

    const { query, queryParams } = neo4j.writeOne.mock.calls[0][0];
    expect(queryParams).toMatchObject({ userId: "user-1", password: "new-hash" });
    expect(query).toMatch(
      /MATCH \(revoked_access:OAuthAccessToken \{userId: user\.id\}\)\s*SET revoked_access\.isRevoked = true/,
    );
    expect(query).toMatch(
      /MATCH \(revoked_refresh:OAuthRefreshToken \{userId: user\.id\}\)\s*SET revoked_refresh\.isRevoked = true/,
    );
    // Revocation is chained to the matched user: it follows the user match and the password SET.
    const userMatch = query.indexOf("MATCH (user:User {id: $userId})");
    const passwordSet = query.indexOf("SET user.password = $password");
    const revoke = query.indexOf("OAuthAccessToken");
    expect(userMatch).toBeGreaterThan(-1);
    expect(userMatch).toBeLessThan(passwordSet);
    expect(passwordSet).toBeLessThan(revoke);
    expect(query).toMatch(/WITH user\s+CALL/);
  });

  it("revokes tokens of every company (no company filter on the tokens)", async () => {
    await repository.resetPassword({ userId: "user-1", password: "new-hash" });

    expect(neo4j.writeOne.mock.calls[0][0].query).not.toMatch(/OAuth(Access|Refresh)Token \{[^}]*companyId/);
  });

  it("does not revoke on invitation acceptance (first password, no prior grant)", async () => {
    await repository.acceptInvitation({ userId: "user-1", password: "first-hash" });

    expect(neo4j.writeOne.mock.calls[0][0].query).not.toContain("OAuthAccessToken");
  });
});
