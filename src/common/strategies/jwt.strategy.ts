import { HttpException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ClsService } from "nestjs-cls";
import { ExtractJwt, Strategy } from "passport-jwt";
import { BaseConfigInterface, ConfigJwtInterface } from "../../config/interfaces";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly cls: ClsService,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    const jwtConfig = configService.get<ConfigJwtInterface>("jwt");
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtConfig?.secret,
      passReqToCallback: true,
    });
  }

  /**
   * Accepts every payload signed with `jwt.secret`: full sessions, pending-2FA and
   * selection tokens all share the key, and `AnyScopeAuthGuard` must still see the
   * selection tokens. The token class is enforced by each guard after this runs
   * (`assertSessionPayload` / `isAcceptedScopedPayload` in `guards/session.token.ts`),
   * so a guard built on `AuthGuard("jwt")` must never trust `request.user` without one
   * of those checks.
   */
  async validate(req: Request, payload: any) {
    const now = new Date();
    const expiration = new Date(payload.expiration);

    if (expiration < now) throw new HttpException("Token expired", 401);

    this.cls.set("userId", payload.userId);

    return payload;
  }
}
