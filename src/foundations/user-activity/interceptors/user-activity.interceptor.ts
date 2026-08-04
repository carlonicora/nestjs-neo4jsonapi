import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { UserActivityService } from "../services/user-activity.service";

const SKIPPED_PATH_PREFIXES = ["/health", "/healthcheck", "/metrics", "/auth"];

/**
 * `category` / `action` are open strings at the library level (see
 * UserActivityRecordInput). These literals are the same values the consuming
 * app's UserActivityCategory / UserActivityAction enums carry.
 */
const ENTITY_CATEGORY = "ENTITY";

const METHOD_TO_ACTION: Record<string, string | undefined> = {
  POST: "CREATE",
  PUT: "UPDATE",
  PATCH: "UPDATE",
  DELETE: "DELETE",
};

/**
 * Captures coarse-grained CRUD events for any authenticated request.
 *
 * Registered as a global APP_INTERCEPTOR by `UserActivityModule.forRoot()` ONLY
 * when `interceptorEnabled: true` — it is off by default so the module is inert
 * for apps that do not opt in.
 *
 * Skips:
 * - GET requests (too noisy for the activity log)
 * - Unauthenticated requests
 * - Health / metrics / auth endpoints (login is recorded explicitly by AuthService)
 *
 * Service-level fine-grained events (AI completions, portal share, agreement
 * generation, email-import) are captured by explicit `UserActivityService.record(...)`
 * calls in those services — not by this interceptor.
 */
@Injectable()
export class UserActivityInterceptor implements NestInterceptor {
  constructor(
    private readonly userActivity: UserActivityService,
    private readonly logger: AppLoggingService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap({
        next: () => this._record(context),
      }),
    );
  }

  private _record(context: ExecutionContext): void {
    try {
      const http = context.switchToHttp();
      // JWT guard puts the JWT payload on request.user with shape:
      // { userId, companyId, roles, ... } (see JwtAuthGuard.canActivate).
      const request = http.getRequest<{
        method?: string;
        url?: string;
        user?: { userId?: string; companyId?: string };
      }>();

      const userId = request?.user?.userId;
      const companyId = request?.user?.companyId;
      if (!userId || !companyId) return;

      const url = (request.url ?? "").split("?")[0];
      if (SKIPPED_PATH_PREFIXES.some((p) => url.startsWith(p))) return;
      if (request.method === "OPTIONS") return;

      const action = METHOD_TO_ACTION[request.method ?? ""];
      if (!action) return;

      void this.userActivity.record({
        userId,
        companyId,
        category: ENTITY_CATEGORY,
        action,
        entityType: this._inferEntityType(url),
        metadata: { method: request.method, path: url },
      });
    } catch (err) {
      this.logger.error(`UserActivityInterceptor failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private _inferEntityType(url: string): string | undefined {
    const segments = url.split("/").filter(Boolean);
    return segments[0]?.match(/^[a-z][a-z-]*$/) ? segments[0] : undefined;
  }
}
