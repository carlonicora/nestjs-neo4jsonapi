import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerRequest } from "@nestjs/throttler";
import { FastifyReply, FastifyRequest } from "fastify";

/**
 * Custom ThrottlerGuard that adds rate limit headers to responses.
 *
 * Headers added:
 * - X-RateLimit-Limit: Maximum number of requests allowed in the time window
 * - X-RateLimit-Remaining: Number of requests remaining in the current window
 * - X-RateLimit-Reset: Unix timestamp when the rate limit window resets
 *
 * Registered as a global APP_GUARD by the bootstrap app module factory when
 * `rateLimit.enabled` is true. Apps do not register it themselves.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: FastifyRequest): Promise<string> {
    return req.ip;
  }

  /**
   * Skip throttling for non-HTTP execution contexts.
   *
   * This guard is registered globally (APP_GUARD), so NestJS also runs it on
   * non-HTTP contexts such as necord Discord slash commands (context type
   * "necord"). Those contexts have no HTTP response object, so calling
   * `switchToHttp().getResponse().header(...)` in `handleRequest` throws
   * `TypeError: response.header is not a function` and, inside a Discord event
   * handler, crashes the worker with an unhandled 'error'. Rate-limit headers
   * only make sense for HTTP, so we skip everything else.
   */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== "http";
  }

  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, limit, ttl, throttler, blockDuration, getTracker, generateKey } = requestProps;

    const response = context.switchToHttp().getResponse<FastifyReply>();
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const tracker = await getTracker(request, context);
    const throttlerName = throttler.name || "default";
    const key = generateKey(context, tracker, throttlerName);

    const { totalHits, timeToExpire } = await this.storageService.increment(
      key,
      ttl,
      limit,
      blockDuration,
      throttlerName,
    );

    const remaining = Math.max(0, limit - totalHits);
    const resetTime = Math.ceil(Date.now() / 1000) + Math.ceil(timeToExpire / 1000);

    // Add rate limit headers to every response
    response.header("X-RateLimit-Limit", String(limit));
    response.header("X-RateLimit-Remaining", String(remaining));
    response.header("X-RateLimit-Reset", String(resetTime));

    if (totalHits > limit) {
      await this.throwThrottlingException(context, {
        totalHits,
        timeToExpire,
        isBlocked: totalHits > limit,
        timeToBlockExpire: timeToExpire,
        ttl,
        limit,
        key,
        tracker,
      });
    }

    return true;
  }
}
