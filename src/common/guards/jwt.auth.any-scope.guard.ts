import { ExecutionContext, HttpException, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ClsService } from "nestjs-cls";

/**
 * Admits BOTH a full session JWT and a scoped selection JWT (e.g. the
 * short-lived "company-selection" token issued at login).
 *
 * The company-selection routes are legitimately reachable by either: a user
 * who belongs to more than one company arrives from the login screen holding
 * only a selection token, while a user switching company from inside the app
 * arrives holding a full token.
 */
@Injectable()
export class AnyScopeAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly cls: ClsService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // Throw rather than `return false`: returning false makes Nest raise a 403,
    // while handleRequest below throws 401 for the very same condition. A
    // missing header and a malformed one must not get different statuses.
    if (!request.headers.authorization) throw new HttpException("Unauthorised", 401);

    return (await super.canActivate(context)) as boolean;
  }

  handleRequest(err, user, info, context) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;

    if (!token) throw new HttpException("Unauthorised", 401);

    if (err || !user) {
      if (info?.message === "jwt expired") throw new HttpException("Token expired", 401);
      if (err) throw err;
      throw new HttpException("Unauthorised", 401);
    }

    this.cls.set("userId", user.userId);
    this.cls.set("token", token.startsWith("Bearer ") ? token.slice(7) : token);

    return user;
  }
}
