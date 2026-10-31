import { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CacheInterceptor } from "../cache.interceptor";

describe("CacheInterceptor", () => {
  let interceptor: CacheInterceptor;
  let cacheService: any;
  let reflector: any;
  let logger: any;

  const buildContext = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
          url: "/api/compendium-entries",
          headers,
          query: { page: 1 },
          body: undefined,
          user: { userId: "user123" },
        }),
        getResponse: () => ({ headers: vi.fn() }),
      }),
      getHandler: () => vi.fn(),
    }) as unknown as ExecutionContext;

  const handler: CallHandler = { handle: () => of({ data: [] }) };

  beforeEach(() => {
    cacheService = {
      shouldCache: vi.fn().mockReturnValue(true),
      generateCacheKey: vi.fn().mockReturnValue("key"),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    reflector = { get: vi.fn().mockReturnValue(undefined) };
    logger = { error: vi.fn() };
    interceptor = new CacheInterceptor(cacheService, reflector, logger);
  });

  it("keys the cache on the normalised x-language header", async () => {
    await interceptor.intercept(buildContext({ "x-language": "it-IT" }), handler);

    expect(cacheService.generateCacheKey).toHaveBeenCalledTimes(1);
    expect(cacheService.generateCacheKey.mock.calls[0][5]).toBe("it");
  });

  it("keys the cache on en when the header is missing", async () => {
    await interceptor.intercept(buildContext({}), handler);

    expect(cacheService.generateCacheKey.mock.calls[0][5]).toBe("en");
  });
});
