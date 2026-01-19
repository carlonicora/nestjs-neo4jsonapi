import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "../controllers/auth.controller";
import { AuthService } from "../services/auth.service";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";

describe("AuthController", () => {
  let controller: AuthController;
  let authService: vi.Mocked<AuthService>;

  const TEST_CODES = {
    authCode: "auth-code-123",
    refreshToken: "refresh-token-456",
    resetCode: "reset-code-789",
    invitationCode: "invite-code-012",
    activationCode: "activate-code-345",
  };

  beforeEach(async () => {
    const mockAuthService = {
      findAuthByCode: vi.fn(),
      refreshToken: vi.fn(),
      deleteByToken: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      startResetPassword: vi.fn(),
      validateCode: vi.fn(),
      resetPassword: vi.fn(),
      acceptInvitation: vi.fn(),
      activateAccount: vi.fn(),
      completeOAuthRegistration: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /auth (findAuth)", () => {
    it("should find auth by code", async () => {
      const mockResponse = { data: { type: "auths", id: "auth-123" } };
      authService.findAuthByCode.mockResolvedValue(mockResponse);

      const result = await controller.findAuth(TEST_CODES.authCode);

      expect(authService.findAuthByCode).toHaveBeenCalledWith({ code: TEST_CODES.authCode });
      expect(result).toEqual(mockResponse);
    });

    it("should handle service errors", async () => {
      authService.findAuthByCode.mockRejectedValue(new Error("Invalid code"));

      await expect(controller.findAuth("invalid-code")).rejects.toThrow("Invalid code");
    });
  });

  describe("POST /auth/refreshtoken/:refreshToken", () => {
    it("should refresh token successfully", async () => {
      const mockResponse = {
        data: {
          type: "auths",
          attributes: { accessToken: "new-access-token", refreshToken: "new-refresh-token" },
        },
      };
      authService.refreshToken.mockResolvedValue(mockResponse);

      const result = await controller.refreshToken(TEST_CODES.refreshToken);

      expect(authService.refreshToken).toHaveBeenCalledWith({ refreshToken: TEST_CODES.refreshToken });
      expect(result).toEqual(mockResponse);
    });

    it("should handle expired refresh token", async () => {
      authService.refreshToken.mockRejectedValue(new Error("Refresh token expired"));

      await expect(controller.refreshToken("expired-token")).rejects.toThrow("Refresh token expired");
    });
  });

  describe("DELETE /auth (deleteSingleAuth)", () => {
    it("should delete auth by token from header", async () => {
      const mockRequest = {
        headers: {
          authorization: "Bearer valid-access-token",
        },
      };
      authService.deleteByToken.mockResolvedValue(undefined);

      const result = await controller.deleteSinglAuth(mockRequest);

      expect(authService.deleteByToken).toHaveBeenCalledWith({ token: "valid-access-token" });
      expect(result).toBeUndefined();
    });

    it("should extract token correctly from Bearer header", async () => {
      const mockRequest = {
        headers: {
          authorization: "Bearer my-jwt-token-with-dots.and.stuff",
        },
      };
      authService.deleteByToken.mockResolvedValue(undefined);

      await controller.deleteSinglAuth(mockRequest);

      expect(authService.deleteByToken).toHaveBeenCalledWith({ token: "my-jwt-token-with-dots.and.stuff" });
    });
  });

  describe("POST /auth/login", () => {
    it("should login with valid credentials", async () => {
      const loginBody = {
        data: {
          type: "auths",
          attributes: {
            email: "test@example.com",
            password: "password123",
          },
        },
      };
      const mockResponse = {
        data: {
          type: "auths",
          attributes: { accessToken: "access-token", refreshToken: "refresh-token" },
        },
      };
      authService.login.mockResolvedValue(mockResponse);

      const result = await controller.login(loginBody as any);

      expect(authService.login).toHaveBeenCalledWith({ data: loginBody.data });
      expect(result).toEqual(mockResponse);
    });

    it("should handle invalid credentials", async () => {
      const loginBody = {
        data: {
          type: "auths",
          attributes: {
            email: "test@example.com",
            password: "wrongpassword",
          },
        },
      };
      authService.login.mockRejectedValue(new Error("Invalid credentials"));

      await expect(controller.login(loginBody as any)).rejects.toThrow("Invalid credentials");
    });
  });

  describe("POST /auth/register", () => {
    it("should register new user", async () => {
      const registerBody = {
        data: {
          type: "auths",
          attributes: {
            email: "new@example.com",
            password: "newpassword123",
          },
        },
      };
      authService.register.mockResolvedValue(undefined);

      await controller.register(registerBody as any);

      expect(authService.register).toHaveBeenCalledWith({ data: registerBody.data });
    });
  });

  describe("POST /auth/forgot", () => {
    it("should start password reset flow", async () => {
      const forgotBody = {
        data: {
          attributes: {
            email: "USER@EXAMPLE.COM",
          },
        },
      };
      authService.startResetPassword.mockResolvedValue(undefined);

      await controller.forgotPassword(forgotBody as any, "en");

      expect(authService.startResetPassword).toHaveBeenCalledWith("user@example.com", "en");
    });

    it("should lowercase email before sending", async () => {
      const forgotBody = {
        data: {
          attributes: {
            email: "UPPERCASE@EMAIL.COM",
          },
        },
      };
      authService.startResetPassword.mockResolvedValue(undefined);

      await controller.forgotPassword(forgotBody as any, undefined);

      expect(authService.startResetPassword).toHaveBeenCalledWith("uppercase@email.com", undefined);
    });
  });

  describe("GET /auth/validate/:code", () => {
    it("should validate reset code", async () => {
      authService.validateCode.mockResolvedValue(undefined);

      await controller.validateResetCode(TEST_CODES.resetCode);

      expect(authService.validateCode).toHaveBeenCalledWith(TEST_CODES.resetCode);
    });

    it("should handle invalid code", async () => {
      authService.validateCode.mockRejectedValue(new Error("Invalid or expired code"));

      await expect(controller.validateResetCode("invalid-code")).rejects.toThrow("Invalid or expired code");
    });
  });

  describe("POST /auth/reset/:code", () => {
    it("should reset password with valid code", async () => {
      const resetBody = {
        data: {
          attributes: {
            password: "newSecurePassword123!",
          },
        },
      };
      authService.resetPassword.mockResolvedValue(undefined);

      controller.resetPassword(resetBody as any, TEST_CODES.resetCode);

      expect(authService.resetPassword).toHaveBeenCalledWith(TEST_CODES.resetCode, "newSecurePassword123!");
    });
  });

  describe("POST /auth/invitation/:code", () => {
    it("should accept invitation and set password", async () => {
      const invitationBody = {
        data: {
          attributes: {
            password: "myNewPassword123!",
          },
        },
      };
      authService.acceptInvitation.mockResolvedValue(undefined);

      controller.acceptInvitation(invitationBody as any, TEST_CODES.invitationCode);

      expect(authService.acceptInvitation).toHaveBeenCalledWith(TEST_CODES.invitationCode, "myNewPassword123!");
    });
  });

  describe("POST /auth/activate/:code", () => {
    it("should activate account with valid code", async () => {
      authService.activateAccount.mockResolvedValue(undefined);

      await controller.activateAccount(TEST_CODES.activationCode);

      expect(authService.activateAccount).toHaveBeenCalledWith(TEST_CODES.activationCode);
    });

    it("should handle already activated account", async () => {
      authService.activateAccount.mockRejectedValue(new Error("Account already activated"));

      await expect(controller.activateAccount("used-code")).rejects.toThrow("Account already activated");
    });
  });

  describe("POST /auth/oauth/complete", () => {
    it("should complete OAuth registration", async () => {
      const oauthBody = {
        pendingId: "pending-123",
        termsAcceptedAt: "2024-01-15T10:00:00Z",
        marketingConsent: true,
        marketingConsentAt: "2024-01-15T10:00:00Z",
      };
      authService.completeOAuthRegistration.mockResolvedValue({ code: "oauth-complete-code" });

      const result = await controller.completeOAuthRegistration(oauthBody);

      expect(authService.completeOAuthRegistration).toHaveBeenCalledWith(oauthBody);
      expect(result).toEqual({ code: "oauth-complete-code" });
    });

    it("should handle OAuth registration without marketing consent", async () => {
      const oauthBody = {
        pendingId: "pending-456",
        termsAcceptedAt: "2024-01-15T10:00:00Z",
        marketingConsent: false,
        marketingConsentAt: null,
      };
      authService.completeOAuthRegistration.mockResolvedValue({ code: "oauth-code-no-marketing" });

      const result = await controller.completeOAuthRegistration(oauthBody);

      expect(authService.completeOAuthRegistration).toHaveBeenCalledWith(oauthBody);
      expect(result.code).toBeDefined();
    });
  });

  describe("dependency injection", () => {
    it("should have authService injected", () => {
      expect(controller["service"]).toBeDefined();
    });
  });
});
