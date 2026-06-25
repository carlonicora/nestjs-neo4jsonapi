import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { FastifyReply } from "fastify";

/**
 * Custom exception filter for throttler/rate limiting errors.
 * Provides user-friendly error messages and includes Retry-After header.
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    // Default retry after 60 seconds (the typical TTL for auth rate limits)
    const retryAfterSeconds = 60;

    response.status(HttpStatus.TOO_MANY_REQUESTS).header("Retry-After", String(retryAfterSeconds)).send({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: "Too Many Requests",
      message: "You have exceeded the rate limit. Please wait before trying again.",
      retryAfter: retryAfterSeconds,
    });
  }
}
