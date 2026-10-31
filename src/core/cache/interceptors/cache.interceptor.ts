import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyReply, FastifyRequest } from "fastify";
import { Observable, of } from "rxjs";
import { tap } from "rxjs/operators";
import { AppLoggingService } from "../../logging/services/logging.service";
import { CacheService } from "../services/cache.service";
import { normaliseRequestLanguage } from "../utils/request-language";

// Decorator to disable caching for specific endpoints
export const NoCache = () => SetMetadata("no-cache", true);

// Decorator to set custom cache TTL
export const CacheTTL = (ttl: number) => SetMetadata("cache-ttl", ttl);

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cacheService: CacheService,
    private readonly reflector: Reflector,
    private readonly logger: AppLoggingService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();

    const method = request.method;
    const url = request.url;

    const noCache = this.reflector.get<boolean>("no-cache", context.getHandler());
    if (noCache) {
      return next.handle();
    }

    const user = (request as any).user;
    const userId = user?.id || user?.userId || "anonymous";

    const query = request.query;
    const body = request.body;

    if (!this.cacheService.shouldCache(method, url)) {
      return next.handle();
    }

    const cacheKey = this.cacheService.generateCacheKey(
      userId,
      method,
      url,
      query,
      body,
      normaliseRequestLanguage(request.headers["x-language"]),
    );

    try {
      const cachedResponse = await this.cacheService.get(cacheKey);
      if (cachedResponse) {
        response.headers({
          "X-Cache": "HIT",
          "X-Cache-Key": cacheKey,
        });

        return of(cachedResponse);
      }

      const customTTL = this.reflector.get<number>("cache-ttl", context.getHandler());
      const ttl = customTTL || undefined;

      return next.handle().pipe(
        tap(async (responseData) => {
          if (responseData && !this.isErrorResponse(responseData)) {
            await this.cacheService.set(cacheKey, responseData, ttl);

            response.headers({
              "X-Cache": "MISS",
              "X-Cache-Key": cacheKey,
            });
          }
        }),
      );
    } catch (error) {
      this.logger?.error(
        `Cache interceptor error for ${method} ${url}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return next.handle();
    }
  }

  private isErrorResponse(responseData: any): boolean {
    if (responseData && (responseData.errors || (responseData.statusCode && responseData.statusCode >= 400)))
      return true;

    return false;
  }
}
