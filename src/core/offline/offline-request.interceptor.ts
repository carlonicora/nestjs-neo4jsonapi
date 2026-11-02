import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Observable } from "rxjs";
import { isOfflineInternalRequest } from "../../foundations/offline-change-set/services/offline-route-runner.service";
import { OFFLINE_CLS_REPLAY, OFFLINE_REPLAY_HEADER } from "./offline.constants";

/**
 * Records in CLS that the request is an offline replay when it carries `x-offline-replay: 1`
 * AND this process's `x-offline-internal` token, i.e. only a step the offline change-set runner
 * injected. A browser may send `x-offline-replay` (the web client uses it to skip its own local
 * answer); without the token it has no effect here. Registered globally by `OfflineModule`.
 */
@Injectable()
export class OfflineRequestInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === "http") {
      const request = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
      const header = request?.headers?.[OFFLINE_REPLAY_HEADER];
      if ((Array.isArray(header) ? header[0] : header) === "1" && isOfflineInternalRequest(request?.headers)) {
        this.cls.set(OFFLINE_CLS_REPLAY, true);
      }
    }

    return next.handle();
  }
}
