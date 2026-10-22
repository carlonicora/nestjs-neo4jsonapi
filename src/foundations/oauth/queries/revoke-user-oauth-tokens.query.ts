/**
 * Cypher that revokes every OAuth access and refresh token of `userAlias`
 * (MCP and other OAuth clients), across every company: deletion and a password
 * change or reset end all of the user's delegated access, not one company's.
 * Tokens are matched on their `userId` property, not on an edge, so the clause
 * also works right before the User node is hard-deleted. Unit subqueries: the
 * outer row passes through unchanged, and the revocation runs only for a row
 * that reached it (the write matched its user). The caller emits the `WITH`
 * that carries `userAlias` (and any other alias it still needs) right before
 * this clause.
 */
export function revokeUserOAuthTokensClause(userAlias = "user"): string {
  return `
      CALL {
        WITH ${userAlias}
        MATCH (revoked_access:OAuthAccessToken {userId: ${userAlias}.id})
        SET revoked_access.isRevoked = true, revoked_access.updatedAt = datetime()
      }
      CALL {
        WITH ${userAlias}
        MATCH (revoked_refresh:OAuthRefreshToken {userId: ${userAlias}.id})
        SET revoked_refresh.isRevoked = true, revoked_refresh.updatedAt = datetime()
      }
    `;
}
