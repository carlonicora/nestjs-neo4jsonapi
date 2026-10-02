import { Injectable, CanActivate, ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { OAuthTokenService } from "../services/oauth.token.service";
import { OAUTH_SCOPES_KEY } from "../../../common/decorators/oauth.scopes.decorator";

/**
 * OAuth Token Guard
 *
 * Protects endpoints using OAuth2 Bearer tokens.
 * Validates the token and checks required scopes.
 *
 * Usage:
 * @UseGuards(OAuthTokenGuard)
 * @OAuthScopes('read')
 * async getDocuments() { ... }
 */
@Injectable()
export class OAuthTokenGuard implements CanActivate {
  constructor(
    private readonly tokenService: OAuthTokenService,
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract Bearer token
    const token = this.extractToken(request);
    if (!token) {
      throw new HttpException("Missing authorization token", 401);
    }

    // Validate token
    const tokenData = await this.tokenService.validateAccessToken(token);
    if (!tokenData) {
      throw new HttpException("Invalid or expired token", 401);
    }

    // Check required scopes
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(OAUTH_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredScopes && requiredScopes.length > 0) {
      if (!this.hasRequiredScopes(tokenData.scope, requiredScopes)) {
        throw new HttpException("Insufficient scope", 403);
      }
    }

    // Set context for downstream services
    this.cls.set("userId", tokenData.userId);
    this.cls.set("companyId", tokenData.companyId);
    this.cls.set("oauthClientId", tokenData.clientId);
    this.cls.set("oauthScopes", tokenData.scope);
    this.cls.set("authType", "oauth");

    // Attach to request for controllers
    request.user = {
      userId: tokenData.userId,
      companyId: tokenData.companyId,
      clientId: tokenData.clientId,
      scopes: tokenData.scope.split(" "),
    };

    return true;
  }

  /**
   * Extracts the Bearer token from the Authorization header.
   */
  private extractToken(request: any): string | null {
    const authHeader = request.headers?.authorization;
    if (!authHeader) {
      return null;
    }

    const [type, token] = authHeader.split(" ");
    if (type !== "Bearer" || !token) {
      return null;
    }

    return token;
  }

  /**
   * Checks if the token's scopes include all required scopes.
   */
  private hasRequiredScopes(tokenScope: string, requiredScopes: string[]): boolean {
    const tokenScopes = tokenScope.split(" ").filter(Boolean);
    return requiredScopes.every((scope) => tokenScopes.includes(scope));
  }
}
