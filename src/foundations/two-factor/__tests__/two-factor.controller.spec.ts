import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

vi.mock("../guards/pending-auth.guard", () => ({
  PendingAuthGuard: class MockPendingAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { TwoFactorController } from "../controllers/two-factor.controller";
import { TwoFactorService } from "../services/two-factor.service";
import { PasskeyService } from "../services/passkey.service";
import { BackupCodeService } from "../services/backup-code.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AuthService } from "../../auth/services/auth.service";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { PendingAuthGuard } from "../guards/pending-auth.guard";

describe("TwoFactorController", () => {
  let controller: TwoFactorController;
  let mockTwoFactorService: vi.Mocked<TwoFactorService>;
  let mockPasskeyService: vi.Mocked<PasskeyService>;
  let mockBackupCodeService: vi.Mocked<BackupCodeService>;
  let mockJsonApiService: vi.Mocked<JsonApiService>;
  let mockAuthService: vi.Mocked<AuthService>;

  const TEST_IDS = {
    userId: "user-123",
    pendingId: "pending-456",
  };

  const createMockRequest = (userId: string = TEST_IDS.userId) => ({
    user: { userId },
  });

  const createMockPendingRequest = (userId: string = TEST_IDS.userId, pendingId: string = TEST_IDS.pendingId) => ({
    pendingAuth: { userId, pendingId },
  });

  const createMockReply = () => ({
    send: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    mockTwoFactorService = {
      getStatus: vi.fn().mockResolvedValue({ data: { isEnabled: true } }),
      enable: vi.fn().mockResolvedValue({ data: { isEnabled: true } }),
      disable: vi.fn().mockResolvedValue(undefined),
      getAvailableMethods: vi.fn().mockResolvedValue(["totp", "passkey"]),
      verifyTotp: vi.fn().mockResolvedValue({ data: { success: true } }),
      verifyBackupCode: vi.fn().mockResolvedValue({ data: { success: true } }),
      updateBackupCodesCount: vi.fn().mockResolvedValue(undefined),
      deletePendingSession: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockPasskeyService = {
      generateAuthenticationOptions: vi.fn().mockResolvedValue({
        data: {
          attributes: {
            pendingId: "passkey-pending",
            options: { challenge: "test-challenge" },
          },
        },
      }),
      verifyAuthentication: vi.fn().mockResolvedValue("passkey-123"),
    } as any;

    mockBackupCodeService = {
      generateCodes: vi.fn().mockResolvedValue({
        data: { codes: ["CODE1234", "CODE5678"], count: 10 },
      }),
      regenerateCodes: vi.fn().mockResolvedValue({
        data: { codes: ["NEWCODE1", "NEWCODE2"], count: 10 },
      }),
      getUnusedCount: vi.fn().mockResolvedValue({ data: { count: 8 } }),
    } as any;

    mockJsonApiService = {
      buildSingle: vi.fn().mockImplementation((model, data) => ({ data })),
      buildList: vi.fn().mockImplementation((model, data) => ({ data })),
    } as any;

    mockAuthService = {
      completeTwoFactorLogin: vi.fn().mockResolvedValue({ data: { token: "auth-token" } }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TwoFactorController],
      providers: [
        { provide: TwoFactorService, useValue: mockTwoFactorService },
        { provide: PasskeyService, useValue: mockPasskeyService },
        { provide: BackupCodeService, useValue: mockBackupCodeService },
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PendingAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TwoFactorController>(TwoFactorController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /auth/two-factor/status", () => {
    it("should return 2FA status for authenticated user", async () => {
      const req = createMockRequest();
      const reply = createMockReply();

      await controller.getStatus(req as any, reply as any);

      expect(mockTwoFactorService.getStatus).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("POST /auth/two-factor/enable", () => {
    it("should enable 2FA with preferred method", async () => {
      const req = createMockRequest();
      const reply = createMockReply();
      const body = {
        data: {
          type: "two-factor-configs",
          attributes: { preferredMethod: "totp" },
        },
      };

      await controller.enable(req as any, reply as any, body as any);

      expect(mockTwoFactorService.enable).toHaveBeenCalledWith(TEST_IDS.userId, "totp");
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("POST /auth/two-factor/disable", () => {
    it("should disable 2FA", async () => {
      const req = createMockRequest();
      const reply = createMockReply();

      await controller.disable(req as any, reply as any);

      expect(mockTwoFactorService.disable).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("POST /auth/two-factor/challenge", () => {
    it("should return passkey authentication options for passkey method", async () => {
      const req = createMockPendingRequest();
      const reply = createMockReply();
      const body = {
        data: {
          type: "two-factor-challenges",
          attributes: { method: "passkey" },
        },
      };

      await controller.challenge(req as any, reply as any, body as any);

      expect(mockPasskeyService.generateAuthenticationOptions).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
      });
      expect(mockJsonApiService.buildSingle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "passkey",
          pendingId: "passkey-pending",
        }),
      );
      expect(reply.send).toHaveBeenCalled();
    });

    it("should return available methods for TOTP challenge", async () => {
      const req = createMockPendingRequest();
      const reply = createMockReply();
      const body = {
        data: {
          type: "two-factor-challenges",
          attributes: { method: "totp" },
        },
      };

      await controller.challenge(req as any, reply as any, body as any);

      expect(mockTwoFactorService.getAvailableMethods).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(mockJsonApiService.buildSingle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: "totp",
          availableMethods: ["totp", "passkey"],
        }),
      );
    });

    it("should return available methods for backup challenge", async () => {
      const req = createMockPendingRequest();
      const reply = createMockReply();
      const body = {
        data: {
          type: "two-factor-challenges",
          attributes: { method: "backup" },
        },
      };

      await controller.challenge(req as any, reply as any, body as any);

      expect(mockTwoFactorService.getAvailableMethods).toHaveBeenCalled();
    });
  });

  describe("POST /auth/two-factor/verify/totp", () => {
    it("should verify TOTP code", async () => {
      const req = createMockPendingRequest();
      const reply = createMockReply();
      const body = {
        data: {
          type: "totp-verifications",
          attributes: { code: "123456" },
        },
      };

      await controller.verifyTotp(req as any, reply as any, body as any);

      expect(mockTwoFactorService.verifyTotp).toHaveBeenCalledWith(TEST_IDS.pendingId, "123456");
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("POST /auth/two-factor/verify/passkey/options", () => {
    it("should return passkey authentication options", async () => {
      const req = createMockPendingRequest();
      const reply = createMockReply();

      await controller.getPasskeyOptions(req as any, reply as any);

      expect(mockPasskeyService.generateAuthenticationOptions).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
      });
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("POST /auth/two-factor/verify/passkey", () => {
    it("should verify passkey authentication", async () => {
      const req = createMockPendingRequest();
      const reply = createMockReply();
      const body = {
        data: {
          type: "passkey-verifications",
          attributes: {
            pendingId: "passkey-challenge-id",
            response: {
              id: "credential-id",
              rawId: "credential-id",
              type: "public-key",
              response: {
                clientDataJSON: "...",
                authenticatorData: "...",
                signature: "...",
              },
            },
          },
        },
      };

      await controller.verifyPasskey(req as any, reply as any, body as any);

      expect(mockPasskeyService.verifyAuthentication).toHaveBeenCalled();
      expect(mockTwoFactorService.deletePendingSession).toHaveBeenCalledWith(TEST_IDS.pendingId);
      expect(mockAuthService.completeTwoFactorLogin).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(reply.send).toHaveBeenCalledWith({ data: { token: "auth-token" } });
    });

    it("should return failure when passkey verification fails", async () => {
      mockPasskeyService.verifyAuthentication.mockResolvedValue(null as any);
      const req = createMockPendingRequest();
      const reply = createMockReply();
      const body = {
        data: {
          type: "passkey-verifications",
          attributes: {
            pendingId: "passkey-challenge-id",
            response: {},
          },
        },
      };

      await controller.verifyPasskey(req as any, reply as any, body as any);

      expect(mockJsonApiService.buildSingle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          success: false,
        }),
      );
    });
  });

  describe("POST /auth/two-factor/verify/backup", () => {
    it("should verify backup code", async () => {
      const req = createMockPendingRequest();
      const reply = createMockReply();
      const body = {
        data: {
          type: "backup-code-verifications",
          attributes: { code: "ABCD1234" },
        },
      };

      await controller.verifyBackupCode(req as any, reply as any, body as any);

      expect(mockTwoFactorService.verifyBackupCode).toHaveBeenCalledWith(TEST_IDS.pendingId, "ABCD1234");
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("POST /auth/backup-codes/generate", () => {
    it("should generate backup codes and update count", async () => {
      const req = createMockRequest();
      const reply = createMockReply();

      await controller.generateBackupCodes(req as any, reply as any);

      expect(mockBackupCodeService.generateCodes).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(mockTwoFactorService.updateBackupCodesCount).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("POST /auth/backup-codes/regenerate", () => {
    it("should regenerate backup codes and update count", async () => {
      const req = createMockRequest();
      const reply = createMockReply();

      await controller.regenerateBackupCodes(req as any, reply as any);

      expect(mockBackupCodeService.regenerateCodes).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(mockTwoFactorService.updateBackupCodesCount).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe("GET /auth/backup-codes/count", () => {
    it("should return backup codes count", async () => {
      const req = createMockRequest();
      const reply = createMockReply();

      await controller.getBackupCodesCount(req as any, reply as any);

      expect(mockBackupCodeService.getUnusedCount).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(reply.send).toHaveBeenCalled();
    });
  });
});
