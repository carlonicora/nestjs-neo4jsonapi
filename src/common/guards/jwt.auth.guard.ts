import { ExecutionContext, HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { ClsService } from "nestjs-cls";
import { Neo4jService } from "../../core/neo4j/services/neo4j.service";
import { ModulePermissionGate } from "../../foundations/rbac/services/module-permission.gate";
import { AUTH_CONTEXT_HOOK, AuthContextHookInterface, SYSTEM_ROLES, SystemRolesInterface } from "../tokens";
import { assertSessionPayload, resolveSessionCompanyId, SessionPayload } from "./session.token";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(
    private readonly cls: ClsService,
    private reflector: Reflector,
    private readonly neo4j: Neo4jService,
    @Optional()
    @Inject(SYSTEM_ROLES)
    private readonly systemRoles?: SystemRolesInterface,
    @Optional()
    @Inject(AUTH_CONTEXT_HOOK)
    private readonly authContextHook?: AuthContextHookInterface,
    // Request permission gate (no-op unless the app sets `permissions.enforce`).
    @Optional()
    @Inject(ModulePermissionGate)
    private readonly permissionGate?: ModulePermissionGate,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorizationHeader = request.headers.authorization;

    if (!authorizationHeader) return false;

    const isAuthenticated = (await super.canActivate(context)) as boolean;

    if (isAuthenticated && request.user && this.authContextHook)
      await this.authContextHook.onAuthenticated({ request, context });

    if (isAuthenticated && request.user && this.permissionGate) await this.permissionGate.assert({ request, context });

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
      throw new HttpException("Unauthorised", 401);
    }

    // Only a full session passes: pending-2FA, selection and portal tokens are signed
    // with the same secret and verify, but must never act as a session.
    // Asserted on a local copy: narrowing `user` itself would change the return type
    // away from IAuthGuard's generic `TUser`.
    const session: unknown = user;
    assertSessionPayload(session);

    this._validateRoles(session, context);

    const companyId = resolveSessionCompanyId({
      payload: session,
      headerCompanyId: request.headers["x-companyid"],
      administratorRole: this.systemRoles?.Administrator,
    });

    this.cls.set("userId", session.userId);
    this.cls.set("companyId", companyId);
    this.cls.set("roles", session.roles);
    this.cls.set("language", request.headers["x-language"]);
    this.cls.set("token", token.startsWith("Bearer ") ? token.slice(7) : token);
    this.cls.set("ipAddress", request.ip);

    return user;
  }

  private _validateRoles(user: SessionPayload, context: ExecutionContext): void {
    // Handler AND class: a class-level @Roles was inert while only the handler was read.
    // Copied, because pushing into the array returned by the reflector mutates the
    // decorator metadata for every later request.
    const requiredRoles: string[] = [
      ...(this.reflector.getAllAndOverride<string[]>("roles", [context.getHandler(), context.getClass()]) ?? []),
    ];
    if (requiredRoles.length > 0) {
      const adminRole = this.systemRoles?.Administrator ?? "administrator";
      if (!requiredRoles.includes(adminRole)) requiredRoles.push(adminRole);
      if (!requiredRoles.some((role) => user.roles.includes(role))) throw new HttpException("Unauthorised", 401);
    }
  }
}
