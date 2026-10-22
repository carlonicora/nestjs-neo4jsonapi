import { describe, it, expect, beforeEach, vi, type Mocked } from "vitest";
import { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { OAuthService } from "./oauth.service";
import { OAuthTokenService } from "./oauth.token.service";
import { OAuthClientService } from "./oauth.client.service";
import { OAuthPkceService } from "./oauth.pkce.service";
import { OAuthScopeService } from "./oauth.scope.service";
import { OAuthRepository } from "../repositories/oauth.repository";
import { OAuthClient } from "../entities/oauth.client.entity";
import { OAuthAuthorizationCode } from "../entities/oauth.authorization.code.entity";
import { OAuthRefreshToken } from "../entities/oauth.refresh.token.entity";

/**
 * Token endpoint rules, run through the real OAuthService + OAuthTokenService
 * with only the repository mocked:
 * - refresh and code exchange refuse a user who is deleted, inactive or no
 *   longer in the token's company;
 * - an authorization code is redeemed once;
 * - introspection needs an authenticated (confidential) client.
 */
describe("OAuthService user access and token endpoint rules", () => {
  let service: OAuthService;
  let repository: Mocked<
    Pick<
      OAuthRepository,
      | "findAuthorizationCodeByHash"
      | "markAuthorizationCodeUsed"
      | "findCompanyIdForUser"
      | "createAccessToken"
      | "createRefreshToken"
      | "findRefreshTokenByHash"
      | "findAccessTokenByHash"
      | "revokeRefreshToken"
      | "revokeAccessToken"
      | "revokeAllUserTokensForClient"
      | "isTokenSubjectAuthorised"
    >
  >;
  let clientService: Mocked<Pick<OAuthClientService, "validateClient">>;

  const client = (overrides: Partial<OAuthClient> = {}): OAuthClient =>
    ({
      id: "client-uuid",
      type: "oauth-clients",
      clientId: "client-id",
      clientSecretHash: "hash",
      name: "Claude",
      redirectUris: ["https://claude.ai/cb"],
      allowedScopes: ["mcp"],
      allowedGrantTypes: ["authorization_code", "refresh_token"],
      isConfidential: false,
      isActive: true,
      accessTokenLifetime: 3600,
      refreshTokenLifetime: 604800,
      ...overrides,
    }) as OAuthClient;

  const storedCode = (overrides: Partial<OAuthAuthorizationCode> = {}): OAuthAuthorizationCode =>
    ({
      id: "code-id",
      codeHash: "code-hash",
      clientId: "client-id",
      userId: "user-id",
      companyId: "company-id",
      redirectUri: "https://claude.ai/cb",
      scope: "mcp",
      isUsed: false,
      expiresAt: new Date(Date.now() + 600_000),
      ...overrides,
    }) as OAuthAuthorizationCode;

  const storedRefresh = (): OAuthRefreshToken =>
    ({
      id: "refresh-id",
      tokenHash: "refresh-hash",
      clientId: "client-id",
      userId: "user-id",
      companyId: "company-id",
      scope: "mcp",
      isRevoked: false,
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 604800_000),
    }) as OAuthRefreshToken;

  const exchange = () =>
    service.exchangeAuthorizationCode({
      grantType: "authorization_code",
      code: "raw-code",
      redirectUri: "https://claude.ai/cb",
      clientId: "client-id",
    });

  const refresh = () =>
    service.refreshTokenGrant({ grantType: "refresh_token", refreshToken: "raw-refresh", clientId: "client-id" });

  beforeEach(() => {
    repository = {
      findAuthorizationCodeByHash: vi.fn().mockResolvedValue(storedCode()),
      markAuthorizationCodeUsed: vi.fn().mockResolvedValue(true),
      findCompanyIdForUser: vi.fn().mockResolvedValue("company-id"),
      createAccessToken: vi.fn().mockResolvedValue("access-id"),
      createRefreshToken: vi.fn().mockResolvedValue("refresh-id"),
      findRefreshTokenByHash: vi.fn().mockResolvedValue(storedRefresh()),
      findAccessTokenByHash: vi.fn().mockResolvedValue(null),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
      revokeAccessToken: vi.fn().mockResolvedValue(undefined),
      revokeAllUserTokensForClient: vi.fn().mockResolvedValue(undefined),
      isTokenSubjectAuthorised: vi.fn().mockResolvedValue(true),
    };
    clientService = { validateClient: vi.fn().mockResolvedValue(client()) };

    const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService<BaseConfigInterface>;
    const tokenService = new OAuthTokenService(repository as unknown as OAuthRepository, config);
    service = new OAuthService(
      repository as unknown as OAuthRepository,
      clientService as unknown as OAuthClientService,
      tokenService,
      new OAuthPkceService(),
      config,
      new OAuthScopeService(config),
    );
  });

  describe("authorization code exchange", () => {
    it("issues tokens for an active member of the code's company", async () => {
      const result = await exchange();

      expect(result.access_token).toBeDefined();
      expect(repository.isTokenSubjectAuthorised).toHaveBeenCalledWith({ userId: "user-id", companyId: "company-id" });
    });

    it.each(["deleted", "inactive", "removed from the company"])(
      "refuses a %s user with invalid_grant and issues no token",
      async () => {
        repository.isTokenSubjectAuthorised.mockResolvedValue(false);

        const error = await exchange().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(400);
        expect((error as HttpException).getResponse()).toMatchObject({ error: "invalid_grant" });
        expect(repository.createAccessToken).not.toHaveBeenCalled();
        expect(repository.createRefreshToken).not.toHaveBeenCalled();
      },
    );

    it("checks the fallback company when the code carries none", async () => {
      repository.findAuthorizationCodeByHash.mockResolvedValue(storedCode({ companyId: null }));
      repository.findCompanyIdForUser.mockResolvedValue("fallback-company");

      await exchange();

      expect(repository.isTokenSubjectAuthorised).toHaveBeenCalledWith({
        userId: "user-id",
        companyId: "fallback-company",
      });
    });

    it("refuses a second redemption of the same code even when both reads saw it unused", async () => {
      // Two parallel exchanges both read isUsed=false; only the first wins the atomic mark.
      repository.markAuthorizationCodeUsed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(exchange()).resolves.toMatchObject({ token_type: "Bearer" });
      const second = await exchange().catch((e: unknown) => e);

      expect(second).toBeInstanceOf(HttpException);
      expect((second as HttpException).getResponse()).toMatchObject({ error: "invalid_grant" });
      expect(repository.createAccessToken).toHaveBeenCalledTimes(1);
    });

    it("refuses a code already marked used and revokes the user's tokens for the client", async () => {
      repository.findAuthorizationCodeByHash.mockResolvedValue(storedCode({ isUsed: true }));

      await expect(exchange()).rejects.toBeInstanceOf(HttpException);
      expect(repository.revokeAllUserTokensForClient).toHaveBeenCalledWith("user-id", "client-id");
      expect(repository.createAccessToken).not.toHaveBeenCalled();
    });
  });

  describe("refresh token grant", () => {
    it("rotates for an active member of the token's company", async () => {
      const result = await refresh();

      expect(result.refresh_token).toBeDefined();
      expect(repository.isTokenSubjectAuthorised).toHaveBeenCalledWith({ userId: "user-id", companyId: "company-id" });
    });

    it.each(["deleted", "inactive", "removed from the company"])(
      "refuses a %s user with invalid_grant, revokes the refresh token and issues nothing",
      async () => {
        repository.isTokenSubjectAuthorised.mockResolvedValue(false);

        const error = await refresh().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(400);
        expect((error as HttpException).getResponse()).toMatchObject({ error: "invalid_grant" });
        expect(repository.revokeRefreshToken).toHaveBeenCalledTimes(1);
        expect(repository.createAccessToken).not.toHaveBeenCalled();
        expect(repository.createRefreshToken).not.toHaveBeenCalled();
      },
    );
  });

  describe("introspection", () => {
    it("refuses a public client with 401 (it authenticates with no secret at all)", async () => {
      clientService.validateClient.mockResolvedValue(client({ isConfidential: false }));

      const error = await service
        .introspectToken({ token: "any", clientId: "client-id", clientSecret: "x" })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect(repository.findAccessTokenByHash).not.toHaveBeenCalled();
    });

    it("refuses a confidential client whose secret does not validate with 401", async () => {
      clientService.validateClient.mockResolvedValue(null);

      await expect(
        service.introspectToken({ token: "any", clientId: "client-id", clientSecret: "wrong" }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("answers an authenticated confidential client", async () => {
      clientService.validateClient.mockResolvedValue(client({ isConfidential: true }));
      repository.findRefreshTokenByHash.mockResolvedValue(null);

      await expect(
        service.introspectToken({ token: "any", clientId: "client-id", clientSecret: "secret" }),
      ).resolves.toEqual({ active: false });
    });
  });
});
