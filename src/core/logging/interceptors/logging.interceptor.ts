import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { ClsService } from "nestjs-cls";
import { catchError, Observable, tap, throwError } from "rxjs";
import { baseConfig } from "../../../config/base.config";
import { AuthenticatedUser } from "../../../common/interfaces/authenticated.request.interface";
import { LogContext } from "../interfaces/logging.interface";
import { AppLoggingService } from "../services/logging.service";

// Extended request type that may have user attached by auth guard
interface RequestWithUser extends FastifyRequest {
  user?: AuthenticatedUser;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly apiConfig = baseConfig.api;

  constructor(
    private readonly loggingService: AppLoggingService,
    private readonly clsService: ClsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<any>): Observable<any> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // Store start time and context on the raw request for the onSend hook
    (request as any).raw["requestStartTime"] = startTime;

    // Extract request details
    const requestId = (request.headers["x-request-id"] as string) || request.id;
    const requestPath = request.url;
    const requestMethod = request.method;
    const userIp = request.ip;
    const userAgent = request.headers["user-agent"];

    // Extract user context if authenticated (user may be attached by JWT guard)
    const userId = request.user?.userId;
    const companyId = request.user?.companyId;

    // Set up request context for logging with trace correlation
    const logContext: LogContext = {
      requestId,
      ip: userIp,
      userAgent,
      method: requestMethod,
      url: requestPath,
      ...(userId && { userId }),
      ...(companyId && { companyId }),
    };

    // Set context in ClsService for the entire request lifecycle
    this.loggingService.setRequestContext(logContext);

    // Store full request URL for pagination links
    if (this.apiConfig?.url && this.clsService) {
      const apiUrl = this.apiConfig.url.replace(/\/$/, "");
      this.clsService.set("requestUrl", `${apiUrl}${requestPath}`);
    }

    return next.handle().pipe(
      tap(() => {
        // Success logging and context clearing are now handled in the onSend hook for accurate timing
        // Nothing to do here for successful requests
      }),
      catchError((error) => {
        const statusCode = error.status || error.statusCode || 500;
        const responseTime = Date.now() - startTime;

        // Extract validation errors if present (used for metadata only)
        const validationErrors =
          error.response?.message && Array.isArray(error.response.message) ? error.response.message : null;

        // Only log non-validation errors here, as HttpExceptionFilter handles validation error logging with details
        if (!validationErrors) {
          // Log error with structured logging (errors don't go through onSend hook)
          this.loggingService.logHttpError(requestMethod, requestPath, error, responseTime, userIp);

          // Enhanced error logging
          this.loggingService.errorWithContext(`Request failed`, error, "HTTP_ERROR", {
            responseTime,
            statusCode,
            errorCode: error.code,
            errorType: error.constructor.name,
          });
        }

        // Clear context after error
        this.loggingService.clearRequestContext();

        return throwError(() => error);
      }),
    );
  }
}
