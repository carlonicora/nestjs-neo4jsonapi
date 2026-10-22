import { ExecutionContext, HttpException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { ClsService } from "nestjs-cls";
import { TOKEN_SCOPES_KEY } from "../decorators/token-scopes.decorator";
import { isAcceptedScopedPayload } from "./session.token";

/**
 * Admits a full session JWT, or a selection JWT whose scope the route lists with
 * `@AllowedTokenScopes(...)` (handler or class). Without that decorator only a full
 * session passes.
 *
 * The company-selection routes are legitimately reachable by either: a user
 * who belongs to more than one company arrives from the login screen holding
 * only a selection token, while a user switching company from inside the app
 * arrives holding a full token.
 *
 * Always refused: a pending-2FA token (it would otherwise mint a full session through
 * POST /auth/company-selection with a password only), a portal token, and a selection
 * token of a scope the route does not list.
 */
@Injectable()
export class AnyScopeAuthGuard extends AuthGuard("jwt") {
  constructor(
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {
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

    const allowedScopes: string[] =
      this.reflector.getAllAndOverride<string[]>(TOKEN_SCOPES_KEY, [context.getHandler(), context.getClass()]) ?? [];

    if (!isAcceptedScopedPayload(user, allowedScopes)) throw new HttpException("Unauthorised", 401);

    this.cls.set("userId", user.userId);
    this.cls.set("token", token.startsWith("Bearer ") ? token.slice(7) : token);

    return user;
  }
}
