import { ExecutionContext, HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { ClsService } from "nestjs-cls";
import { SYSTEM_ROLES, SystemRolesInterface } from "../tokens";
import { assertSessionPayload, resolveSessionCompanyId, SessionPayload } from "./session.token";

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  constructor(
    private readonly cls: ClsService,
    private reflector: Reflector,
    @Optional()
    @Inject(SYSTEM_ROLES)
    private readonly systemRoles?: SystemRolesInterface,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorizationHeader = request.headers.authorization;

    if (!authorizationHeader && request.user) {
      return true;
    }

    return super.canActivate(context) as boolean;
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;

    if (!token) return null;

    if (err || !user) {
      if (info?.message === "jwt expired") {
        throw new HttpException("Token expired", 401);
      } else if (err) {
        throw err;
      }
      return null;
    }

    // A token that is present and verifies but is not a full session (pending-2FA,
    // selection, portal) is refused, not downgraded to anonymous.
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
    this.cls.set("language", request.headers["x-language"]);
    this.cls.set("roles", session.roles);

    return user;
  }

  private _validateRoles(user: SessionPayload, context: ExecutionContext): void {
    // Handler AND class, copied so pushing the admin role never mutates the metadata.
    const requiredRoles: string[] = [
      ...(this.reflector.getAllAndOverride<string[]>("roles", [context.getHandler(), context.getClass()]) ?? []),
    ];
    if (requiredRoles.length > 0) {
      if (!user) throw new HttpException("Unauthorised", 401);
      const adminRole = this.systemRoles?.Administrator ?? "administrator";
      if (!requiredRoles.includes(adminRole)) requiredRoles.push(adminRole);
      if (!requiredRoles.some((role) => user.roles.includes(role))) throw new HttpException("Unauthorised", 401);
    }
  }
}
