import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Optional } from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { AppLoggingService } from "../../core/logging/services/logging.service";

/**
 * Determine if we're in production mode.
 * Stack traces should be hidden from clients and sanitized in logs in production.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Sanitize error message for client response in production.
 * Internal server errors should not expose implementation details.
 */
function sanitizeClientMessage(status: number, message: string): string {
  if (status >= 500 && isProduction()) {
    return "An internal error occurred. Please try again later.";
  }
  return message;
}

/**
 * Sanitize stack trace for logging in production.
 * Remove absolute paths and sensitive information.
 */
function sanitizeStackTrace(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  if (!isProduction()) return stack;

  // In production, keep the stack but remove absolute paths
  return stack
    .split("\n")
    .map((line) => {
      // Remove absolute paths, keep relative structure
      return line
        .replace(/\s+at\s+.+\(\/.+\/node_modules\//g, "    at [node_modules]/")
        .replace(/\s+at\s+.+\(\/.+\/packages\//g, "    at [packages]/")
        .replace(/\s+at\s+.+\(\/.+\/src\//g, "    at [src]/");
    })
    .join("\n");
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@Optional() private readonly logger?: AppLoggingService) {}

  /**
   * Check if the exception is a validation error from NestJS ValidationPipe
   */
  private isValidationError(exception: HttpException): boolean {
    const response = exception.getResponse();
    return (
      typeof response === "object" && response !== null && "message" in response && Array.isArray(response.message)
    );
  }

  /**
   * Extract validation error messages from the exception
   * Returns null if this is not a validation error
   */
  private extractValidationErrors(exception: HttpException): string[] | null {
    if (!this.isValidationError(exception)) {
      return null;
    }
    const response = exception.getResponse() as any;
    return response.message;
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? exception.getResponse() : "Internal server error";
    const timestamp = new Date().toISOString();

    // Get request context from the logging service (includes userId, companyId, requestId)
    const requestContext = this.logger?.getRequestContext();

    // Build structured error log entry
    const structuredLogEntry = {
      level: status >= 500 ? "error" : "warn",
      timestamp,
      context: "HttpExceptionFilter",
      error: {
        status,
        name: exception instanceof Error ? exception.name : "UnknownError",
        message: exception instanceof Error ? exception.message : String(message),
        stack: sanitizeStackTrace(exception instanceof Error ? exception.stack : undefined),
      },
      request: {
        method: request.method,
        url: request.url,
        requestId: requestContext?.requestId || request.id,
        userId: requestContext?.userId,
        companyId: requestContext?.companyId,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      },
    };

    // Enhanced logging for validation errors
    if (exception instanceof HttpException && this.logger) {
      const validationErrors = this.extractValidationErrors(exception);
      if (validationErrors) {
        // Include validation errors in structured log
        const validationErrorsFormatted = validationErrors.map((e) => `  - ${e}`).join("\n");
        this.logger.warn(
          `Validation Error: ${status} - ${request.method} ${request.url}\n\nValidation Errors:\n${validationErrorsFormatted}`,
          "HttpExceptionFilter",
          {
            ...structuredLogEntry,
            validationErrors,
          },
        );
      } else if (status >= 500) {
        // Log 5xx errors as error level with full context
        this.logger.error(
          `Server Error: ${status} - ${request.method} ${request.url}`,
          exception instanceof Error ? exception : undefined,
          "HttpExceptionFilter",
          structuredLogEntry,
        );
      } else {
        // Log 4xx errors as warn level
        this.logger.warn(
          `Client Error: ${status} - ${request.method} ${request.url}`,
          "HttpExceptionFilter",
          structuredLogEntry,
        );
      }
    } else if (this.logger) {
      // Non-HttpException errors (always 500)
      this.logger.error(
        `Unhandled Exception: ${status} - ${request.method} ${request.url}`,
        exception instanceof Error ? exception : undefined,
        "HttpExceptionFilter",
        structuredLogEntry,
      );
    }

    // Extract the error detail message for both the JSON:API errors array and the top-level message field
    const rawErrorDetail = typeof message === "string" ? message : (message as any)?.message || "An error occurred";

    // Sanitize the client-facing message (hide internal details in production for 5xx)
    const errorDetail = sanitizeClientMessage(status, rawErrorDetail);

    const errorResponse = {
      message: errorDetail, // Top-level message for easy frontend consumption
      errors: [
        {
          status: status.toString(),
          title: HttpStatus[status] || "Unknown Error",
          detail: errorDetail,
          source: {
            pointer: request.url,
          },
          meta: {
            timestamp,
            path: request.url,
            method: request.method,
            // Only include requestId in response, never userId/companyId
            requestId: requestContext?.requestId || request.id,
          },
        },
      ],
    };

    response.status(status).send(errorResponse);
  }
}
