import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Optional } from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { AppLoggingService } from "../../core/logging/services/logging.service";

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

    // Enhanced logging for validation errors
    if (exception instanceof HttpException && this.logger) {
      const validationErrors = this.extractValidationErrors(exception);
      if (validationErrors) {
        // Include validation errors directly in the message for console visibility
        const validationErrorsFormatted = validationErrors.map((e) => `  - ${e}`).join("\n");
        const stackTrace = exception instanceof Error ? exception.stack : String(exception);
        const errorMessage = `Unhandled Exception: ${status} - ${request.method} ${request.url}\n\nValidation Errors:\n${validationErrorsFormatted}\n\nStack: ${stackTrace}`;
        this.logger.error(errorMessage, stackTrace, HttpExceptionFilter.name);
      } else {
        // Existing error logging for non-validation errors
        this.logger.error(
          `Unhandled Exception: ${status} - ${request.method} ${request.url}`,
          exception instanceof Error ? exception.stack : String(exception),
          HttpExceptionFilter.name,
        );
      }
    } else if (this.logger) {
      // Non-HttpException errors
      this.logger.error(
        `Unhandled Exception: ${status} - ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
        HttpExceptionFilter.name,
      );
    }

    // Extract the error detail message for both the JSON:API errors array and the top-level message field
    const errorDetail =
      typeof message === "string" ? message : (message as any)?.message || "An error occurred";

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
            timestamp: new Date().toISOString(),
            path: request.url,
            method: request.method,
          },
        },
      ],
    };

    response.status(status).send(errorResponse);
  }
}
