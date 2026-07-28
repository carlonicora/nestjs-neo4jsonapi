import { Injectable, OnModuleInit } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { randomUUID } from "crypto";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { OAuthAccessToken } from "../entities/oauth.access.token.entity";
import { OAuthAccessTokenModel } from "../entities/oauth.access.token.model";
import { OAuthAuthorizationCode } from "../entities/oauth.authorization.code.entity";
import { OAuthAuthorizationCodeModel } from "../entities/oauth.authorization.code.model";
import { OAuthClient } from "../entities/oauth.client.entity";
import { OAuthClientModel } from "../entities/oauth.client.model";
import { OAuthRefreshToken } from "../entities/oauth.refresh.token.entity";
import { OAuthRefreshTokenModel } from "../entities/oauth.refresh.token.model";

@Injectable()
export class OAuthRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    // Create unique constraints for OAuth entities
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT oauth_client_id IF NOT EXISTS FOR (c:OAuthClient) REQUIRE c.id IS UNIQUE`,
    });
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT oauth_client_clientid IF NOT EXISTS FOR (c:OAuthClient) REQUIRE c.clientId IS UNIQUE`,
    });
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT oauth_access_token_hash IF NOT EXISTS FOR (t:OAuthAccessToken) REQUIRE t.tokenHash IS UNIQUE`,
    });
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT oauth_refresh_token_hash IF NOT EXISTS FOR (t:OAuthRefreshToken) REQUIRE t.tokenHash IS UNIQUE`,
    });
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT oauth_auth_code_hash IF NOT EXISTS FOR (c:OAuthAuthorizationCode) REQUIRE c.codeHash IS UNIQUE`,
    });
    // Indexes for performance
    await this.neo4j.writeOne({
      query: `CREATE INDEX oauth_client_owner IF NOT EXISTS FOR (c:OAuthClient) ON (c.ownerId)`,
    });
    await this.neo4j.writeOne({
      query: `CREATE INDEX oauth_access_token_expires IF NOT EXISTS FOR (t:OAuthAccessToken) ON (t.expiresAt)`,
    });
    await this.neo4j.writeOne({
      query: `CREATE INDEX oauth_refresh_token_expires IF NOT EXISTS FOR (t:OAuthRefreshToken) ON (t.expiresAt)`,
    });
  }

  // ============================================
  // CLIENT METHODS
  // ============================================

  async createClient(params: {
    name: string;
    description?: string;
    redirectUris: string[];
    allowedScopes: string[];
    allowedGrantTypes: string[];
    isConfidential: boolean;
    accessTokenLifetime?: number;
    refreshTokenLifetime?: number;
    /** Owning user. Optional: dynamically registered clients (RFC 7591) have no owner. */
    ownerId?: string;
    companyId?: string;
  }): Promise<{ client: OAuthClient; clientSecret?: string }> {
    const id = randomUUID();
    const clientId = randomUUID();
    let clientSecret: string | undefined;
    let clientSecretHash: string | null = null;

    // Generate secret for confidential clients
    if (params.isConfidential) {
      clientSecret = crypto.randomBytes(32).toString("base64url");
      clientSecretHash = await bcrypt.hash(clientSecret, 10);
    }

    const query = this.neo4j.initQuery({ serialiser: OAuthClientModel });
    query.queryParams = {
      id,
      clientId,
      clientSecretHash,
      name: params.name,
      description: params.description ?? null,
      redirectUris: JSON.stringify(params.redirectUris),
      allowedScopes: JSON.stringify(params.allowedScopes),
      allowedGrantTypes: JSON.stringify(params.allowedGrantTypes),
      isConfidential: params.isConfidential,
      isActive: true,
      accessTokenLifetime: params.accessTokenLifetime ?? 3600,
      refreshTokenLifetime: params.refreshTokenLifetime ?? 604800,
      ownerId: params.ownerId ?? null,
      companyId: params.companyId ?? null,
    };

    // Build query conditionally: owner and company MATCHes/relationships only
    // when the respective id is provided (ownerless = RFC 7591 dynamic registration;
    // companyless = admin use case).
    const matchClauses: string[] = [];
    const relationshipClauses: string[] = [];
    if (params.ownerId) {
      matchClauses.push("MATCH (owner:User {id: $ownerId})");
      relationshipClauses.push("CREATE (owner)-[:OWNS_CLIENT]->(oauthclient)");
    }
    if (params.companyId) {
      matchClauses.push("MATCH (company:Company {id: $companyId})");
      relationshipClauses.push("CREATE (company)-[:HAS_OAUTH_CLIENT]->(oauthclient)");
    }

    query.query = `
        ${matchClauses.join("\n        ")}
        CREATE (oauthclient:OAuthClient {
          id: $id,
          clientId: $clientId,
          clientSecretHash: $clientSecretHash,
          name: $name,
          description: $description,
          redirectUris: $redirectUris,
          allowedScopes: $allowedScopes,
          allowedGrantTypes: $allowedGrantTypes,
          isConfidential: $isConfidential,
          isActive: $isActive,
          accessTokenLifetime: $accessTokenLifetime,
          refreshTokenLifetime: $refreshTokenLifetime,
          ownerId: $ownerId,
          companyId: $companyId,
          createdAt: datetime(),
          updatedAt: datetime()
        })
        ${relationshipClauses.join("\n        ")}
        RETURN oauthclient
      `;

    const client = await this.neo4j.writeOne(query);
    return { client, clientSecret };
  }

  async findClientByClientId(clientId: string): Promise<OAuthClient | null> {
    const query = this.neo4j.initQuery({ serialiser: OAuthClientModel });
    query.queryParams = { clientId };
    query.query = `
      MATCH (oauthclient:OAuthClient {clientId: $clientId})
      OPTIONAL MATCH (oauthclient_owner:User)-[:OWNS_CLIENT]->(oauthclient)
      OPTIONAL MATCH (oauthclient_company:Company)-[:HAS_OAUTH_CLIENT]->(oauthclient)
      RETURN oauthclient, oauthclient_owner, oauthclient_company
    `;
    try {
      return await this.neo4j.readOne(query);
    } catch {
      return null;
    }
  }

  async findClientById(id: string): Promise<OAuthClient | null> {
    const query = this.neo4j.initQuery({ serialiser: OAuthClientModel });
    query.queryParams = { id };
    query.query = `
      MATCH (oauthclient:OAuthClient {id: $id})
      OPTIONAL MATCH (oauthclient_owner:User)-[:OWNS_CLIENT]->(oauthclient)
      OPTIONAL MATCH (oauthclient_company:Company)-[:HAS_OAUTH_CLIENT]->(oauthclient)
      RETURN oauthclient, oauthclient_owner, oauthclient_company
    `;
    try {
      return await this.neo4j.readOne(query);
    } catch {
      return null;
    }
  }

  async findClientsByOwnerId(ownerId: string): Promise<OAuthClient[]> {
    const query = this.neo4j.initQuery({ serialiser: OAuthClientModel });
    query.queryParams = { ownerId };
    query.query = `
      MATCH (owner:User {id: $ownerId})-[:OWNS_CLIENT]->(oauthclient:OAuthClient)
      OPTIONAL MATCH (oauthclient_company:Company)-[:HAS_OAUTH_CLIENT]->(oauthclient)
      RETURN oauthclient, owner AS oauthclient_owner, oauthclient_company
      ORDER BY oauthclient.createdAt DESC
    `;
    return this.neo4j.readMany(query);
  }

  async updateClient(
    clientId: string,
    updates: Partial<{
      name: string;
      description: string;
      redirectUris: string[];
      allowedScopes: string[];
      isActive: boolean;
    }>,
  ): Promise<OAuthClient> {
    const setClauses: string[] = ["oauthclient.updatedAt = datetime()"];
    const params: Record<string, any> = { clientId };

    if (updates.name !== undefined) {
      setClauses.push("oauthclient.name = $name");
      params.name = updates.name;
    }
    if (updates.description !== undefined) {
      setClauses.push("oauthclient.description = $description");
      params.description = updates.description;
    }
    if (updates.redirectUris !== undefined) {
      setClauses.push("oauthclient.redirectUris = $redirectUris");
      params.redirectUris = JSON.stringify(updates.redirectUris);
    }
    if (updates.allowedScopes !== undefined) {
      setClauses.push("oauthclient.allowedScopes = $allowedScopes");
      params.allowedScopes = JSON.stringify(updates.allowedScopes);
    }
    if (updates.isActive !== undefined) {
      setClauses.push("oauthclient.isActive = $isActive");
      params.isActive = updates.isActive;
    }

    const query = this.neo4j.initQuery({ serialiser: OAuthClientModel });
    query.queryParams = params;
    query.query = `
      MATCH (oauthclient:OAuthClient {clientId: $clientId})
      SET ${setClauses.join(", ")}
      RETURN oauthclient
    `;
    return this.neo4j.writeOne(query);
  }

  async regenerateClientSecret(clientId: string): Promise<{ clientSecret: string }> {
    const clientSecret = crypto.randomBytes(32).toString("base64url");
    const clientSecretHash = await bcrypt.hash(clientSecret, 10);

    const query = this.neo4j.initQuery();
    query.queryParams = { clientId, clientSecretHash };
    query.query = `
      MATCH (c:OAuthClient {clientId: $clientId})
      SET c.clientSecretHash = $clientSecretHash, c.updatedAt = datetime()
      RETURN c
    `;
    await this.neo4j.writeOne(query);
    return { clientSecret };
  }

  async deleteClient(clientId: string): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { clientId };
    query.query = `
      MATCH (c:OAuthClient {clientId: $clientId})
      OPTIONAL MATCH (c)-[:ISSUED_CODE]->(code:OAuthAuthorizationCode)
      OPTIONAL MATCH (c)-[:ISSUED_ACCESS_TOKEN]->(at:OAuthAccessToken)
      OPTIONAL MATCH (at)-[:LINKED_REFRESH]->(rt:OAuthRefreshToken)
      DETACH DELETE c, code, at, rt
    `;
    await this.neo4j.writeOne(query);
  }

  // ============================================
  // AUTHORIZATION CODE METHODS
  // ============================================

  async createAuthorizationCode(params: {
    code: string;
    clientId: string;
    userId: string;
    redirectUri: string;
    scope: string;
    state?: string;
    codeChallenge?: string;
    codeChallengeMethod?: "S256" | "plain";
    expiresAt: Date;
  }): Promise<void> {
    const id = randomUUID();
    const codeHash = crypto.createHash("sha256").update(params.code).digest("hex");

    const query = this.neo4j.initQuery();
    query.queryParams = {
      id,
      codeHash,
      clientId: params.clientId,
      userId: params.userId,
      redirectUri: params.redirectUri,
      scope: params.scope,
      state: params.state ?? null,
      codeChallenge: params.codeChallenge ?? null,
      codeChallengeMethod: params.codeChallengeMethod ?? null,
      expiresAt: params.expiresAt.toISOString(),
    };

    query.query = `
      MATCH (client:OAuthClient {clientId: $clientId})
      MATCH (user:User {id: $userId})
      CREATE (code:OAuthAuthorizationCode {
        id: $id,
        codeHash: $codeHash,
        redirectUri: $redirectUri,
        scope: $scope,
        state: $state,
        codeChallenge: $codeChallenge,
        codeChallengeMethod: $codeChallengeMethod,
        isUsed: false,
        clientId: $clientId,
        userId: $userId,
        expiresAt: datetime($expiresAt),
        createdAt: datetime()
      })
      CREATE (client)-[:ISSUED_CODE]->(code)
      CREATE (user)-[:AUTHORIZED_CODE]->(code)
      RETURN code
    `;
    await this.neo4j.writeOne(query);
  }

  async findAuthorizationCodeByHash(codeHash: string): Promise<OAuthAuthorizationCode | null> {
    const query = this.neo4j.initQuery({ serialiser: OAuthAuthorizationCodeModel });
    query.queryParams = { codeHash };
    query.query = `
      MATCH (oauthauthorizationcode:OAuthAuthorizationCode {codeHash: $codeHash})
      RETURN oauthauthorizationcode
    `;
    try {
      return await this.neo4j.readOne(query);
    } catch {
      return null;
    }
  }

  async markAuthorizationCodeUsed(codeHash: string): Promise<boolean> {
    // Atomic update - returns true only if code was not already used
    const query = this.neo4j.initQuery();
    query.queryParams = { codeHash };
    query.query = `
      MATCH (code:OAuthAuthorizationCode {codeHash: $codeHash, isUsed: false})
      SET code.isUsed = true
      RETURN code
    `;
    try {
      await this.neo4j.writeOne(query);
      return true;
    } catch {
      return false;
    }
  }

  async deleteExpiredAuthorizationCodes(): Promise<void> {
    const query = this.neo4j.initQuery();
    query.query = `
      MATCH (code:OAuthAuthorizationCode)
      WHERE code.expiresAt < datetime()
      DETACH DELETE code
    `;
    await this.neo4j.writeOne(query);
  }

  // ============================================
  // ACCESS TOKEN METHODS
  // ============================================

  async createAccessToken(params: {
    token: string;
    clientId: string;
    userId?: string;
    companyId?: string;
    scope: string;
    grantType: string;
    expiresAt: Date;
  }): Promise<string> {
    const id = randomUUID();
    const tokenHash = crypto.createHash("sha256").update(params.token).digest("hex");

    const query = this.neo4j.initQuery();
    query.queryParams = {
      id,
      tokenHash,
      clientId: params.clientId,
      userId: params.userId ?? null,
      companyId: params.companyId ?? null,
      scope: params.scope,
      grantType: params.grantType,
      expiresAt: params.expiresAt.toISOString(),
    };

    query.query = `
      MATCH (client:OAuthClient {clientId: $clientId})
      CREATE (token:OAuthAccessToken {
        id: $id,
        tokenHash: $tokenHash,
        clientId: $clientId,
        userId: $userId,
        companyId: $companyId,
        scope: $scope,
        grantType: $grantType,
        isRevoked: false,
        expiresAt: datetime($expiresAt),
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (client)-[:ISSUED_ACCESS_TOKEN]->(token)
      ${params.userId ? "WITH token MATCH (user:User {id: $userId}) CREATE (user)-[:HAS_ACCESS_TOKEN]->(token)" : ""}
      RETURN token
    `;

    await this.neo4j.writeOne(query);
    return id;
  }

  async findAccessTokenByHash(tokenHash: string): Promise<OAuthAccessToken | null> {
    const query = this.neo4j.initQuery({ serialiser: OAuthAccessTokenModel });
    query.queryParams = { tokenHash };
    query.query = `
      MATCH (oauthaccesstoken:OAuthAccessToken {tokenHash: $tokenHash})
      RETURN oauthaccesstoken
    `;
    try {
      return await this.neo4j.readOne(query);
    } catch {
      return null;
    }
  }

  async revokeAccessToken(tokenHash: string): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { tokenHash };
    query.query = `
      MATCH (token:OAuthAccessToken {tokenHash: $tokenHash})
      SET token.isRevoked = true, token.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  // ============================================
  // REFRESH TOKEN METHODS
  // ============================================

  async createRefreshToken(params: {
    token: string;
    clientId: string;
    userId: string;
    companyId?: string;
    scope: string;
    accessTokenId: string;
    expiresAt: Date;
  }): Promise<string> {
    const id = randomUUID();
    const tokenHash = crypto.createHash("sha256").update(params.token).digest("hex");

    const query = this.neo4j.initQuery();
    query.queryParams = {
      id,
      tokenHash,
      clientId: params.clientId,
      userId: params.userId,
      companyId: params.companyId ?? null,
      scope: params.scope,
      accessTokenId: params.accessTokenId,
      expiresAt: params.expiresAt.toISOString(),
    };

    query.query = `
      MATCH (at:OAuthAccessToken {id: $accessTokenId})
      CREATE (rt:OAuthRefreshToken {
        id: $id,
        tokenHash: $tokenHash,
        clientId: $clientId,
        userId: $userId,
        companyId: $companyId,
        scope: $scope,
        isRevoked: false,
        rotationCounter: 0,
        accessTokenId: $accessTokenId,
        expiresAt: datetime($expiresAt),
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (at)-[:LINKED_REFRESH]->(rt)
      RETURN rt
    `;

    await this.neo4j.writeOne(query);
    return id;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<OAuthRefreshToken | null> {
    const query = this.neo4j.initQuery({ serialiser: OAuthRefreshTokenModel });
    query.queryParams = { tokenHash };
    query.query = `
      MATCH (oauthrefreshtoken:OAuthRefreshToken {tokenHash: $tokenHash})
      RETURN oauthrefreshtoken
    `;
    try {
      return await this.neo4j.readOne(query);
    } catch {
      return null;
    }
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { tokenHash };
    query.query = `
      MATCH (token:OAuthRefreshToken {tokenHash: $tokenHash})
      SET token.isRevoked = true, token.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  async revokeAllUserTokensForClient(userId: string, clientId: string): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { userId, clientId };
    query.query = `
      MATCH (at:OAuthAccessToken {userId: $userId, clientId: $clientId})
      SET at.isRevoked = true, at.updatedAt = datetime()
      WITH at
      OPTIONAL MATCH (at)-[:LINKED_REFRESH]->(rt:OAuthRefreshToken)
      SET rt.isRevoked = true, rt.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  async deleteExpiredTokens(): Promise<void> {
    const query = this.neo4j.initQuery();
    query.query = `
      MATCH (at:OAuthAccessToken)
      WHERE at.expiresAt < datetime()
      OPTIONAL MATCH (at)-[:LINKED_REFRESH]->(rt:OAuthRefreshToken)
      DETACH DELETE at, rt
    `;
    await this.neo4j.writeOne(query);
  }

  // ============================================
  // USER LOOKUP METHODS
  // ============================================

  /**
   * Looks up the company ID for a user.
   * Used to include companyId in OAuth tokens for proper scoping.
   * Uses raw Neo4j query to avoid circular dependency with CompanyDescriptor.
   */
  async findCompanyIdForUser(userId: string): Promise<string | null> {
    const query = `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company:Company)
      RETURN company.id AS companyId
    `;
    try {
      const result = await this.neo4j.read(query, { userId });
      if (result.records.length === 0) {
        return null;
      }
      const companyId = result.records[0].get("companyId");
      return companyId ?? null;
    } catch {
      return null;
    }
  }
}
