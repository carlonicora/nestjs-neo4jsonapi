import { CanActivate, ExecutionContext, HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { ClsService } from "nestjs-cls";
import { Neo4jService } from "../../core/neo4j/services/neo4j.service";
import { AUTH_CONTEXT_HOOK, AuthContextHookInterface, SYSTEM_ROLES, SystemRolesInterface } from "../tokens";

@Injectable()
export class AdminJwtAuthGuard extends AuthGuard("jwt") implements CanActivate {
  constructor(
    private readonly cls: ClsService,
    private reflector: Reflector,
    private readonly neo4j: Neo4jService,
    @Optional()
    @Inject(SYSTEM_ROLES)
    private readonly systemRoles?: SystemRolesInterface,
    // Same optional seam `JwtAuthGuard` already exposes. Without it an app that
    // needs per-request context in CLS after authentication (company
    // configuration, entitlements, …) had no way to get it from THIS guard and
    // had to fork the whole file — which is how the `return null` bypass above
    // survived in the package while forks were immune.
    @Optional()
    @Inject(AUTH_CONTEXT_HOOK)
    private readonly authContextHook?: AuthContextHookInterface,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorizationHeader = request.headers.authorization;

    if (!authorizationHeader) return false;

    const isAuthenticated = (await super.canActivate(context)) as boolean;

    // Mirrors JwtAuthGuard.canActivate — same ordering, same guard conditions.
    if (isAuthenticated && request.user && this.authContextHook)
      await this.authContextHook.onAuthenticated({ request, context });

    return isAuthenticated;
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;

    if (!token) throw new HttpException("Unauthorised", 401);

    if (err || !user) {
      if (info?.message === "jwt expired") {
        throw new HttpException("Token expired", 401);
      } else if (err) {
        throw err;
      }
      // SECURITY: must THROW, never `return null`.
      //
      // @nestjs/passport's AuthGuard.canActivate assigns whatever handleRequest
      // returns to `request.user` and then returns `true` unconditionally
      // (auth.guard.js:45-46 in v11.0.5). Returning null therefore ADMITTED the
      // request — with no user — and `_validateRoles` below never ran, so any
      // caller presenting a token that passport rejects for a reason other than
      // expiry (a forged signature, a malformed JWT) reached admin-only routes.
      // Reachable on every route this guard protects, which includes the
      // package's own rbac, feature, company, waitlist and stripe-* controllers.
      throw new HttpException("Unauthorised", 401);
    }

    this._validateRoles(user, context);

    this.cls.set("userId", user.userId);
    this.cls.set("companyId", user.companyId ?? request.headers["x-companyid"]);
    this.cls.set("language", request.headers["x-language"]);
    this.cls.set("roles", user.roles);

    return user;
  }

  private _validateRoles(user: any, context: any): void {
    const requiredRoles: string[] = this.reflector.get<string[]>("roles", context.getHandler()) ?? [];

    const adminRole = this.systemRoles?.Administrator ?? "administrator";
    if (!requiredRoles.includes(adminRole)) requiredRoles.push(adminRole);

    if (!requiredRoles.some((role) => user.roles.includes(role))) throw new HttpException("Unauthorised", 401);
  }
}
