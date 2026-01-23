import { Injectable, CanActivate, ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { OAuthTokenService } from "../../foundations/oauth/services/oauth.token.service";
import { OAUTH_SCOPES_KEY } from "../decorators/oauth.scopes.decorator";
import { JwtAuthGuard } from "./jwt.auth.guard";
import { Neo4jService } from "../../core/neo4j/services/neo4j.service";
import { ModuleRef } from "@nestjs/core";

/**
 * Combined JWT or OAuth Guard
 *
 * Attempts OAuth token validation first, then falls back to JWT.
 * Enables gradual migration from JWT-only to OAuth-enabled endpoints.
 *
 * Usage:
 * @UseGuards(JwtOrOAuthGuard)
 * async getResource() { ... }
 */
@Injectable()
export class JwtOrOAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: OAuthTokenService,
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
    private readonly neo4j: Neo4jService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;

    if (!authHeader) {
      throw new HttpException("Missing authorization", 401);
    }

    // Try OAuth first if it looks like a Bearer token
    if (authHeader.startsWith("Bearer ")) {
      const oauthResult = await this.tryOAuth(context, authHeader);
      if (oauthResult !== null) {
        return oauthResult;
      }
    }

    // Fall back to JWT
    try {
      const jwtGuard = this.moduleRef.get(JwtAuthGuard, { strict: false });
      return (await jwtGuard.canActivate(context)) as boolean;
    } catch (_error) {
      throw new HttpException("Invalid authentication", 401);
    }
  }

  /**
   * Attempts OAuth token validation.
   * @returns true if valid, false if invalid, null if not an OAuth token
   */
  private async tryOAuth(context: ExecutionContext, authHeader: string): Promise<boolean | null> {
    const token = authHeader.slice(7); // Remove 'Bearer '

    try {
      const tokenData = await this.tokenService.validateAccessToken(token);

      if (!tokenData) {
        // Token invalid - might be a JWT, return null to try JWT
        return null;
      }

      // Check required scopes
      const requiredScopes = this.reflector.getAllAndOverride<string[]>(OAUTH_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (requiredScopes && requiredScopes.length > 0) {
        const tokenScopes = tokenData.scope.split(" ");
        if (!requiredScopes.every((s) => tokenScopes.includes(s))) {
          throw new HttpException("Insufficient scope", 403);
        }
      }

      // Set context
      this.cls.set("userId", tokenData.userId);
      this.cls.set("companyId", tokenData.companyId);
      this.cls.set("oauthClientId", tokenData.clientId);
      this.cls.set("oauthScopes", tokenData.scope);
      this.cls.set("authType", "oauth");

      const request = context.switchToHttp().getRequest();
      request.user = {
        userId: tokenData.userId,
        companyId: tokenData.companyId,
        clientId: tokenData.clientId,
        scopes: tokenData.scope.split(" "),
      };

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Not a valid OAuth token, might be JWT
      return null;
    }
  }
}
