import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PendingAuthGuard, PendingAuthPayload } from "../guards/pending-auth.guard";

describe("PendingAuthGuard", () => {
  let guard: PendingAuthGuard;
  let mockJwtService: Mocked<JwtService>;

  const TEST_TOKEN = "valid.jwt.token";
  const TEST_PAYLOAD: PendingAuthPayload = {
    userId: "user-123",
    pendingId: "pending-456",
    type: "pending_2fa",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const createMockExecutionContext = (authHeader?: string): ExecutionContext => {
    const mockRequest = {
      headers: {
        authorization: authHeader,
      },
      pendingAuth: undefined as PendingAuthPayload | undefined,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockJwtService = {
      verify: vi.fn().mockReturnValue(TEST_PAYLOAD),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [PendingAuthGuard, { provide: JwtService, useValue: mockJwtService }],
    }).compile();

    guard = module.get<PendingAuthGuard>(PendingAuthGuard);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("canActivate", () => {
    it("should return true for valid pending 2FA token", async () => {
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockJwtService.verify).toHaveBeenCalledWith(TEST_TOKEN);
    });

    it("should attach decoded payload to request.pendingAuth", async () => {
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      await guard.canActivate(context);

      const request = context.switchToHttp().getRequest();
      expect(request.pendingAuth).toEqual(TEST_PAYLOAD);
    });

    it("should throw UnauthorizedException when authorization header is missing", async () => {
      const context = createMockExecutionContext(undefined);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when authorization header does not start with Bearer", async () => {
      const context = createMockExecutionContext("Basic sometoken");

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException for invalid token", async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error("Invalid token");
      });
      const context = createMockExecutionContext(`Bearer invalid.token`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException for expired token", async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error("jwt expired");
      });
      const context = createMockExecutionContext(`Bearer expired.token`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException for wrong token type", async () => {
      mockJwtService.verify.mockReturnValue({
        userId: "user-123",
        type: "access_token", // Wrong type - should be pending_2fa
      });
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when userId is missing", async () => {
      mockJwtService.verify.mockReturnValue({
        pendingId: "pending-456",
        type: "pending_2fa",
      });
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when pendingId is missing", async () => {
      mockJwtService.verify.mockReturnValue({
        userId: "user-123",
        type: "pending_2fa",
      });
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when token payload is null", async () => {
      mockJwtService.verify.mockReturnValue(null);
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException when token payload is not an object", async () => {
      // Deliberately malformed: `verify` is typed to return an object, the guard must reject a string.
      mockJwtService.verify.mockReturnValue("string-payload" as unknown as object);
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should handle authorization header with extra spaces", async () => {
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should preserve UnauthorizedException messages from token validation", async () => {
      mockJwtService.verify.mockReturnValue({
        userId: "user-123",
        pendingId: "pending-456",
        type: "wrong_type",
      });
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      try {
        await guard.canActivate(context);
        expect.fail("Should have thrown UnauthorizedException");
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).message).toContain("expected pending 2FA token");
      }
    });

    it("should return correct error message for invalid or expired token", async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error("jwt expired");
      });
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      try {
        await guard.canActivate(context);
        expect.fail("Should have thrown UnauthorizedException");
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).message).toContain("Invalid or expired pending token");
      }
    });
  });

  describe("isPendingToken validation", () => {
    it("should validate complete pending token payload", async () => {
      const validPayload: PendingAuthPayload = {
        userId: "user-123",
        pendingId: "pending-456",
        type: "pending_2fa",
        exp: Date.now() + 3600000,
      };
      mockJwtService.verify.mockReturnValue(validPayload);
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("should reject tokens with non-string userId", async () => {
      mockJwtService.verify.mockReturnValue({
        userId: 123, // Should be string
        pendingId: "pending-456",
        type: "pending_2fa",
      });
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("should reject tokens with non-string pendingId", async () => {
      mockJwtService.verify.mockReturnValue({
        userId: "user-123",
        pendingId: 456, // Should be string
        type: "pending_2fa",
      });
      const context = createMockExecutionContext(`Bearer ${TEST_TOKEN}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });
});
