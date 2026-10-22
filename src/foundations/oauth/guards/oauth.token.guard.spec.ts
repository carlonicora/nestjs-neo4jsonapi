import { describe, it, expect, beforeEach, vi, type Mocked } from "vitest";
import { ExecutionContext, HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { OAuthTokenGuard } from "./oauth.token.guard";
import { OAuthTokenService } from "../services/oauth.token.service";
import { OAuthRepository } from "../repositories/oauth.repository";
import { McpController } from "../../../mcp/controllers/mcp.controller";
import { OAUTH_SCOPES_KEY } from "../../../common/decorators/oauth.scopes.decorator";
import { OAuthAccessToken } from "../entities/oauth.access.token.entity";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";

/**
 * The guard runs on every MCP request. A valid, unexpired token is not enough:
 * the user must still exist, be active and belong to the token's company, and
 * the token must carry the scope the route requires.
 */
describe("OAuthTokenGuard", () => {
  let guard: OAuthTokenGuard;
  let repository: Mocked<
    Pick<OAuthRepository, "findAccessTokenByHash" | "isTokenSubjectAuthorised" | "revokeAccessToken">
  >;
  let cls: Mocked<Pick<ClsService, "set">>;

  const storedToken = (overrides: Partial<OAuthAccessToken> = {}): OAuthAccessToken =>
    ({
      id: "token-id",
      type: "oauth-access-tokens",
      tokenHash: "hash",
      scope: "mcp",
      expiresAt: new Date(Date.now() + 3600_000),
      isRevoked: false,
      grantType: "authorization_code",
      clientId: "client-id",
      userId: "user-id",
      companyId: "company-id",
      ...overrides,
    }) as OAuthAccessToken;

  const contextFor = (controller: object, handler: object): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: "Bearer raw-token" } }) }),
      getHandler: () => handler,
      getClass: () => controller,
    }) as unknown as ExecutionContext;

  const mcpContext = () => contextFor(McpController, McpController.prototype.handle);

  beforeEach(() => {
    repository = {
      findAccessTokenByHash: vi.fn().mockResolvedValue(storedToken()),
      isTokenSubjectAuthorised: vi.fn().mockResolvedValue(true),
      revokeAccessToken: vi.fn().mockResolvedValue(undefined),
    };
    cls = { set: vi.fn() };
    const tokenService = new OAuthTokenService(
      repository as unknown as OAuthRepository,
      { get: vi.fn() } as unknown as ConfigService<BaseConfigInterface>,
    );
    guard = new OAuthTokenGuard(tokenService, new Reflector(), cls as unknown as ClsService);
  });

  describe("user re-check", () => {
    it("lets an active member of the token's company through", async () => {
      await expect(guard.canActivate(mcpContext())).resolves.toBe(true);
      expect(repository.isTokenSubjectAuthorised).toHaveBeenCalledWith({ userId: "user-id", companyId: "company-id" });
      expect(cls.set).toHaveBeenCalledWith("userId", "user-id");
    });

    it.each(["deleted", "inactive", "removed from the token's company"])(
      "refuses a %s user with 401 and revokes the token",
      async () => {
        repository.isTokenSubjectAuthorised.mockResolvedValue(false);

        const error = await guard.canActivate(mcpContext()).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(401);
        expect(repository.revokeAccessToken).toHaveBeenCalledTimes(1);
        expect(cls.set).not.toHaveBeenCalled();
      },
    );

    it("checks the user against the token's own company, not any company", async () => {
      repository.findAccessTokenByHash.mockResolvedValue(storedToken({ companyId: "company-b" }));

      await guard.canActivate(mcpContext());

      expect(repository.isTokenSubjectAuthorised).toHaveBeenCalledWith({ userId: "user-id", companyId: "company-b" });
    });

    it("does not look up a user for a client_credentials token (no user)", async () => {
      class PlainController {
        handle() {}
      }
      repository.findAccessTokenByHash.mockResolvedValue(
        storedToken({ userId: null, companyId: null, grantType: "client_credentials", scope: "read" }),
      );

      await expect(guard.canActivate(contextFor(PlainController, PlainController.prototype.handle))).resolves.toBe(
        true,
      );
      expect(repository.isTokenSubjectAuthorised).not.toHaveBeenCalled();
    });
  });

  describe("MCP scope", () => {
    it("McpController requires the mcp scope at class level", () => {
      expect(Reflect.getMetadata(OAUTH_SCOPES_KEY, McpController)).toEqual(["mcp"]);
    });

    it("refuses a token granted only the profile scope with 403 on POST /mcp", async () => {
      repository.findAccessTokenByHash.mockResolvedValue(storedToken({ scope: "profile" }));

      const error = await guard.canActivate(mcpContext()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
      expect(cls.set).not.toHaveBeenCalled();
    });

    it("refuses read/write scopes without mcp", async () => {
      repository.findAccessTokenByHash.mockResolvedValue(storedToken({ scope: "read write" }));

      await expect(guard.canActivate(mcpContext())).rejects.toMatchObject({ status: 403 });
    });

    it("accepts a token that carries mcp among other scopes", async () => {
      repository.findAccessTokenByHash.mockResolvedValue(storedToken({ scope: "profile mcp" }));

      await expect(guard.canActivate(mcpContext())).resolves.toBe(true);
    });
  });
});
