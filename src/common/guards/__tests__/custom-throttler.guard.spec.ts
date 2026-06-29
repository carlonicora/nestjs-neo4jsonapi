import { describe, it, expect, beforeEach, afterEach, vi, MockedObject } from "vitest";
import { ExecutionContext } from "@nestjs/common";
import { ThrottlerStorage, ThrottlerRequest } from "@nestjs/throttler";
import { Reflector } from "@nestjs/core";
import { FastifyRequest, FastifyReply } from "fastify";
import { CustomThrottlerGuard } from "../custom-throttler.guard";

const createMockStorageRecord = (totalHits: number, timeToExpire: number) => ({
  totalHits,
  timeToExpire,
  isBlocked: false,
  timeToBlockExpire: 0,
});

describe("CustomThrottlerGuard", () => {
  let guard: CustomThrottlerGuard;
  let mockStorageService: MockedObject<ThrottlerStorage>;
  let mockReflector: MockedObject<Reflector>;
  let mockContext: MockedObject<ExecutionContext>;
  let mockRequest: MockedObject<FastifyRequest>;
  let mockResponse: MockedObject<FastifyReply>;

  // Test data constants
  const MOCK_IP = "192.168.1.100";
  const MOCK_LIMIT = 10;
  const MOCK_TTL = 60000;
  const MOCK_BLOCK_DURATION = 0;
  const MOCK_KEY = "test-key";
  const MOCK_TRACKER = MOCK_IP;

  beforeEach(() => {
    // Mock storage service
    mockStorageService = {
      increment: vi.fn(),
      get: vi.fn(),
    } as any;

    // Mock reflector
    mockReflector = {
      getAllAndOverride: vi.fn(),
    } as any;

    // Mock FastifyRequest
    mockRequest = {
      ip: MOCK_IP,
    } as any;

    // Mock FastifyReply with header method
    mockResponse = {
      header: vi.fn().mockReturnThis(),
    } as any;

    // Mock ExecutionContext
    mockContext = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue(mockRequest),
        getResponse: vi.fn().mockReturnValue(mockResponse),
      }),
      getClass: vi.fn(),
      getHandler: vi.fn(),
      getArgs: vi.fn(),
      getArgByIndex: vi.fn(),
      switchToRpc: vi.fn(),
      switchToWs: vi.fn(),
      getType: vi.fn(),
    } as any;

    // Create guard instance
    guard = new CustomThrottlerGuard(
      {
        throttlers: [{ name: "default", limit: MOCK_LIMIT, ttl: MOCK_TTL }],
      } as any,
      mockStorageService as any,
      mockReflector as any,
    );

    // Access the protected storageService and set it
    (guard as any).storageService = mockStorageService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getTracker", () => {
    it("should return the IP address from the request", async () => {
      const tracker = await (guard as any).getTracker(mockRequest);

      expect(tracker).toBe(MOCK_IP);
    });

    it("should handle undefined IP gracefully", async () => {
      const requestWithoutIp = { ip: undefined } as FastifyRequest;

      const tracker = await (guard as any).getTracker(requestWithoutIp);

      expect(tracker).toBeUndefined();
    });

    it("should handle IPv6 addresses", async () => {
      const ipv6Address = "::1";
      const requestWithIpv6 = { ip: ipv6Address } as FastifyRequest;

      const tracker = await (guard as any).getTracker(requestWithIpv6);

      expect(tracker).toBe(ipv6Address);
    });
  });

  describe("handleRequest", () => {
    const createRequestProps = (overrides: Partial<ThrottlerRequest> = {}): ThrottlerRequest => ({
      context: mockContext as ExecutionContext,
      limit: MOCK_LIMIT,
      ttl: MOCK_TTL,
      throttler: { name: "default", limit: MOCK_LIMIT, ttl: MOCK_TTL },
      blockDuration: MOCK_BLOCK_DURATION,
      getTracker: vi.fn().mockResolvedValue(MOCK_TRACKER),
      generateKey: vi.fn().mockReturnValue(MOCK_KEY),
      ...overrides,
    });

    it("should set rate limit headers when request is within limit", async () => {
      const totalHits = 5;
      const timeToExpire = 30000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const requestProps = createRequestProps();
      const result = await (guard as any).handleRequest(requestProps);

      expect(result).toBe(true);
      expect(mockResponse.header).toHaveBeenCalledWith("X-RateLimit-Limit", String(MOCK_LIMIT));
      expect(mockResponse.header).toHaveBeenCalledWith("X-RateLimit-Remaining", String(MOCK_LIMIT - totalHits));
      expect(mockResponse.header).toHaveBeenCalledWith("X-RateLimit-Reset", expect.stringMatching(/^\d+$/));
    });

    it("should set remaining to 0 when totalHits equals limit", async () => {
      const totalHits = MOCK_LIMIT;
      const timeToExpire = 30000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const requestProps = createRequestProps();
      await (guard as any).handleRequest(requestProps);

      expect(mockResponse.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");
    });

    it("should set remaining to 0 when totalHits exceeds limit (before throwing)", async () => {
      const totalHits = MOCK_LIMIT + 5;
      const timeToExpire = 30000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      // Mock throwThrottlingException to prevent it from actually throwing
      const throwSpy = vi.spyOn(guard as any, "throwThrottlingException").mockResolvedValue(undefined);

      const requestProps = createRequestProps();
      await (guard as any).handleRequest(requestProps);

      expect(mockResponse.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");
      expect(throwSpy).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({
          totalHits,
          timeToExpire,
          isBlocked: true,
          limit: MOCK_LIMIT,
          key: MOCK_KEY,
          tracker: MOCK_TRACKER,
        }),
      );
    });

    it("should throw throttling exception when limit is exceeded", async () => {
      const totalHits = MOCK_LIMIT + 1;
      const timeToExpire = 30000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      // Make throwThrottlingException actually throw
      const throttleError = new Error("Too Many Requests");
      vi.spyOn(guard as any, "throwThrottlingException").mockRejectedValue(throttleError);

      const requestProps = createRequestProps();

      await expect((guard as any).handleRequest(requestProps)).rejects.toThrow("Too Many Requests");
    });

    it("should call storageService.increment with correct parameters", async () => {
      const totalHits = 3;
      const timeToExpire = 45000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const requestProps = createRequestProps();
      await (guard as any).handleRequest(requestProps);

      expect(mockStorageService.increment).toHaveBeenCalledWith(
        MOCK_KEY,
        MOCK_TTL,
        MOCK_LIMIT,
        MOCK_BLOCK_DURATION,
        "default",
      );
    });

    it("should use default throttler name when not provided", async () => {
      const totalHits = 1;
      const timeToExpire = 60000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const requestProps = createRequestProps({
        throttler: { name: undefined as any, limit: MOCK_LIMIT, ttl: MOCK_TTL },
      });
      const generateKeyMock = vi.fn().mockReturnValue("test-key-default");
      requestProps.generateKey = generateKeyMock;

      await (guard as any).handleRequest(requestProps);

      expect(generateKeyMock).toHaveBeenCalledWith(mockContext, MOCK_TRACKER, "default");
    });

    it("should calculate reset time correctly", async () => {
      const totalHits = 2;
      const timeToExpire = 30000; // 30 seconds
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const beforeTime = Math.ceil(Date.now() / 1000);
      const requestProps = createRequestProps();
      await (guard as any).handleRequest(requestProps);
      const afterTime = Math.ceil(Date.now() / 1000);

      // Get the reset time that was set
      const resetCall = mockResponse.header.mock.calls.find((call) => call[0] === "X-RateLimit-Reset");
      expect(resetCall).toBeDefined();
      const resetTime = parseInt(resetCall![1] as string, 10);

      // Reset time should be current time + timeToExpire/1000 (within reasonable tolerance)
      const expectedMinReset = beforeTime + Math.ceil(timeToExpire / 1000);
      const expectedMaxReset = afterTime + Math.ceil(timeToExpire / 1000);

      expect(resetTime).toBeGreaterThanOrEqual(expectedMinReset);
      expect(resetTime).toBeLessThanOrEqual(expectedMaxReset);
    });

    it("should handle zero remaining requests", async () => {
      const totalHits = MOCK_LIMIT;
      const timeToExpire = 10000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const requestProps = createRequestProps();
      const result = await (guard as any).handleRequest(requestProps);

      expect(result).toBe(true);
      expect(mockResponse.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");
    });

    it("should call getTracker with correct arguments", async () => {
      const totalHits = 1;
      const timeToExpire = 60000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const getTrackerMock = vi.fn().mockResolvedValue(MOCK_TRACKER);
      const requestProps = createRequestProps({ getTracker: getTrackerMock });

      await (guard as any).handleRequest(requestProps);

      expect(getTrackerMock).toHaveBeenCalledWith(mockRequest, mockContext);
    });

    it("should call generateKey with correct arguments", async () => {
      const totalHits = 1;
      const timeToExpire = 60000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const generateKeyMock = vi.fn().mockReturnValue(MOCK_KEY);
      const requestProps = createRequestProps({ generateKey: generateKeyMock });

      await (guard as any).handleRequest(requestProps);

      expect(generateKeyMock).toHaveBeenCalledWith(mockContext, MOCK_TRACKER, "default");
    });
  });

  describe("Edge Cases", () => {
    it("should handle storageService.increment error", async () => {
      const storageError = new Error("Storage error");
      mockStorageService.increment.mockRejectedValue(storageError);

      const requestProps: ThrottlerRequest = {
        context: mockContext as ExecutionContext,
        limit: MOCK_LIMIT,
        ttl: MOCK_TTL,
        throttler: { name: "default", limit: MOCK_LIMIT, ttl: MOCK_TTL },
        blockDuration: MOCK_BLOCK_DURATION,
        getTracker: vi.fn().mockResolvedValue(MOCK_TRACKER),
        generateKey: vi.fn().mockReturnValue(MOCK_KEY),
      };

      await expect((guard as any).handleRequest(requestProps)).rejects.toThrow("Storage error");
    });

    it("should handle very large hit counts", async () => {
      const totalHits = 1000000;
      const timeToExpire = 60000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      vi.spyOn(guard as any, "throwThrottlingException").mockResolvedValue(undefined);

      const requestProps: ThrottlerRequest = {
        context: mockContext as ExecutionContext,
        limit: MOCK_LIMIT,
        ttl: MOCK_TTL,
        throttler: { name: "default", limit: MOCK_LIMIT, ttl: MOCK_TTL },
        blockDuration: MOCK_BLOCK_DURATION,
        getTracker: vi.fn().mockResolvedValue(MOCK_TRACKER),
        generateKey: vi.fn().mockReturnValue(MOCK_KEY),
      };

      await (guard as any).handleRequest(requestProps);

      // Remaining should be 0, not negative
      expect(mockResponse.header).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");
    });

    it("should handle custom throttler name", async () => {
      const customThrottlerName = "custom-throttler";
      const totalHits = 1;
      const timeToExpire = 60000;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const generateKeyMock = vi.fn().mockReturnValue("custom-key");
      const requestProps: ThrottlerRequest = {
        context: mockContext as ExecutionContext,
        limit: MOCK_LIMIT,
        ttl: MOCK_TTL,
        throttler: { name: customThrottlerName, limit: MOCK_LIMIT, ttl: MOCK_TTL },
        blockDuration: MOCK_BLOCK_DURATION,
        getTracker: vi.fn().mockResolvedValue(MOCK_TRACKER),
        generateKey: generateKeyMock,
      };

      await (guard as any).handleRequest(requestProps);

      expect(generateKeyMock).toHaveBeenCalledWith(mockContext, MOCK_TRACKER, customThrottlerName);
      expect(mockStorageService.increment).toHaveBeenCalledWith(
        "custom-key",
        MOCK_TTL,
        MOCK_LIMIT,
        MOCK_BLOCK_DURATION,
        customThrottlerName,
      );
    });

    it("should handle zero TTL", async () => {
      const totalHits = 1;
      const timeToExpire = 0;
      mockStorageService.increment.mockResolvedValue(createMockStorageRecord(totalHits, timeToExpire));

      const requestProps: ThrottlerRequest = {
        context: mockContext as ExecutionContext,
        limit: MOCK_LIMIT,
        ttl: 0,
        throttler: { name: "default", limit: MOCK_LIMIT, ttl: 0 },
        blockDuration: MOCK_BLOCK_DURATION,
        getTracker: vi.fn().mockResolvedValue(MOCK_TRACKER),
        generateKey: vi.fn().mockReturnValue(MOCK_KEY),
      };

      await (guard as any).handleRequest(requestProps);

      expect(mockStorageService.increment).toHaveBeenCalledWith(
        MOCK_KEY,
        0,
        MOCK_LIMIT,
        MOCK_BLOCK_DURATION,
        "default",
      );
    });
  });
});
