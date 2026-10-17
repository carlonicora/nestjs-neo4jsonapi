import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { TwoFactorService } from "../services/two-factor.service";
import { TwoFactorConfigRepository } from "../repositories/two-factor-config.repository";
import { PendingTwoFactorRepository } from "../repositories/pending-two-factor.repository";
import { TotpService } from "../services/totp.service";
import { PasskeyService } from "../services/passkey.service";
import { BackupCodeService } from "../services/backup-code.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { TwoFactorConfig } from "../entities/two-factor-config";
import { PendingTwoFactor } from "../entities/pending-two-factor";

// Mock baseConfig
vi.mock("../../../config/base.config", () => ({
  baseConfig: {
    twoFactor: {
      pendingTtl: 300,
    },
  },
}));

describe("TwoFactorService", () => {
  let service: TwoFactorService;
  let mockJsonApiService: Mocked<JsonApiService>;
  let mockTwoFactorConfigRepository: Mocked<TwoFactorConfigRepository>;
  let mockPendingTwoFactorRepository: Mocked<PendingTwoFactorRepository>;
  let mockTotpService: Mocked<TotpService>;
  let mockPasskeyService: Mocked<PasskeyService>;
  let mockBackupCodeService: Mocked<BackupCodeService>;

  const TEST_IDS = {
    userId: "user-123",
    configId: "config-456",
    pendingId: "pending-789",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockJsonApiService = {
      buildSingle: vi.fn().mockImplementation((model, data) => ({ data })),
      buildList: vi.fn().mockImplementation((model, data) => ({ data })),
    } as any;

    mockTwoFactorConfigRepository = {
      findByUserId: vi.fn().mockResolvedValue(null),
      createForUser: vi.fn().mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: true,
        preferredMethod: "totp",
      }),
      updateByUserId: vi.fn().mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: true,
        preferredMethod: "totp",
      }),
    } as any;

    mockPendingTwoFactorRepository = {
      createForUser: vi.fn().mockResolvedValue({
        id: TEST_IDS.pendingId,
        challenge: "test-challenge",
        challengeType: "login",
        expiration: new Date(Date.now() + 300000),
      }),
      findByIdWithUser: vi.fn(),
      deletePending: vi.fn().mockResolvedValue(undefined),
      incrementAttemptCount: vi.fn().mockResolvedValue(1),
    } as any;

    mockTotpService = {
      hasVerifiedAuthenticator: vi.fn().mockResolvedValue(false),
      verifyCodeForUser: vi.fn().mockResolvedValue(null),
    } as any;

    mockPasskeyService = {
      hasPasskeys: vi.fn().mockResolvedValue(false),
      generateAuthenticationOptions: vi.fn().mockResolvedValue({
        data: { attributes: { pendingId: "passkey-pending" } },
      }),
      verifyAuthentication: vi.fn().mockResolvedValue("passkey-123"),
    } as any;

    mockBackupCodeService = {
      getRawUnusedCount: vi.fn().mockResolvedValue(0),
      validateCode: vi.fn().mockResolvedValue(false),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: TwoFactorConfigRepository, useValue: mockTwoFactorConfigRepository },
        { provide: PendingTwoFactorRepository, useValue: mockPendingTwoFactorRepository },
        { provide: TotpService, useValue: mockTotpService },
        { provide: PasskeyService, useValue: mockPasskeyService },
        { provide: BackupCodeService, useValue: mockBackupCodeService },
      ],
    }).compile();

    service = module.get<TwoFactorService>(TwoFactorService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getConfig", () => {
    it("should return user 2FA config", async () => {
      const config = { id: TEST_IDS.configId, isEnabled: true, preferredMethod: "totp" } as TwoFactorConfig;
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue(config);

      const result = await service.getConfig(TEST_IDS.userId);

      expect(result).toEqual(config);
    });

    it("should return null when user has no config", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue(null);

      const result = await service.getConfig(TEST_IDS.userId);

      expect(result).toBeNull();
    });
  });

  describe("getStatus", () => {
    it("should return full 2FA status for user", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: true,
        preferredMethod: "totp",
      } as TwoFactorConfig);
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(true);
      mockPasskeyService.hasPasskeys.mockResolvedValue(true);
      mockBackupCodeService.getRawUnusedCount.mockResolvedValue(8);

      const result = await service.getStatus(TEST_IDS.userId);

      expect(result.data).toMatchObject({
        id: TEST_IDS.userId,
        isEnabled: true,
        preferredMethod: "totp",
        methods: {
          totp: true,
          passkey: true,
          backup: true,
        },
        backupCodesCount: 8,
      });
    });

    it("should return disabled status when user has no config", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue(null);

      const result = await service.getStatus(TEST_IDS.userId);

      expect(result.data.isEnabled).toBe(false);
    });
  });

  describe("enable", () => {
    it("should enable 2FA when user has TOTP configured", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(true);

      const result = await service.enable(TEST_IDS.userId);

      expect(result).toBeDefined();
      expect(mockTwoFactorConfigRepository.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          isEnabled: true,
          preferredMethod: "totp",
        }),
      );
    });

    it("should enable 2FA when user has passkey configured", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(false);
      mockPasskeyService.hasPasskeys.mockResolvedValue(true);

      const result = await service.enable(TEST_IDS.userId, "passkey");

      expect(result).toBeDefined();
    });

    it("should throw BadRequestException when no methods configured", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(false);
      mockPasskeyService.hasPasskeys.mockResolvedValue(false);

      await expect(service.enable(TEST_IDS.userId)).rejects.toThrow(BadRequestException);
    });

    it("should fall back to available method when preferred is not configured", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(false);
      mockPasskeyService.hasPasskeys.mockResolvedValue(true);

      await service.enable(TEST_IDS.userId, "totp"); // Prefer TOTP but not configured

      expect(mockTwoFactorConfigRepository.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredMethod: "passkey",
        }),
      );
    });

    it("should update existing config when enabling", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: false,
      } as TwoFactorConfig);
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(true);

      await service.enable(TEST_IDS.userId);

      expect(mockTwoFactorConfigRepository.updateByUserId).toHaveBeenCalled();
      expect(mockTwoFactorConfigRepository.createForUser).not.toHaveBeenCalled();
    });
  });

  describe("disable", () => {
    it("should disable 2FA for user", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: true,
      } as TwoFactorConfig);

      const result = await service.disable(TEST_IDS.userId);

      expect(mockTwoFactorConfigRepository.updateByUserId).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          isEnabled: false,
        }),
      );
    });

    it("should return null when user has no config", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue(null);

      const result = await service.disable(TEST_IDS.userId);

      expect(result).toBeNull();
    });
  });

  describe("setPreferredMethod", () => {
    it("should set TOTP as preferred method", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: true,
      } as TwoFactorConfig);
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(true);

      await service.setPreferredMethod(TEST_IDS.userId, "totp");

      expect(mockTwoFactorConfigRepository.updateByUserId).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredMethod: "totp",
        }),
      );
    });

    it("should throw BadRequestException when method not available", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: true,
      } as TwoFactorConfig);
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(false);

      await expect(service.setPreferredMethod(TEST_IDS.userId, "totp")).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for backup method", async () => {
      await expect(service.setPreferredMethod(TEST_IDS.userId, "backup")).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when config not found", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue(null);
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(true);

      await expect(service.setPreferredMethod(TEST_IDS.userId, "totp")).rejects.toThrow(NotFoundException);
    });
  });

  describe("createPendingSession", () => {
    it("should create pending 2FA session", async () => {
      const result = await service.createPendingSession(TEST_IDS.userId);

      expect(result).toHaveProperty("pendingId");
      expect(result).toHaveProperty("expiration");
      expect(mockPendingTwoFactorRepository.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          challengeType: "login",
        }),
      );
    });
  });

  describe("getAvailableMethods", () => {
    it("should return all available methods", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(true);
      mockPasskeyService.hasPasskeys.mockResolvedValue(true);
      mockBackupCodeService.getRawUnusedCount.mockResolvedValue(5);

      const result = await service.getAvailableMethods(TEST_IDS.userId);

      expect(result).toContain("totp");
      expect(result).toContain("passkey");
      expect(result).toContain("backup");
    });

    it("should return empty array when no methods configured", async () => {
      const result = await service.getAvailableMethods(TEST_IDS.userId);

      expect(result).toHaveLength(0);
    });

    it("should exclude backup when no codes available", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(true);
      mockBackupCodeService.getRawUnusedCount.mockResolvedValue(0);

      const result = await service.getAvailableMethods(TEST_IDS.userId);

      expect(result).toContain("totp");
      expect(result).not.toContain("backup");
    });
  });

  describe("verifyTotp", () => {
    beforeEach(() => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "login",
          expiration: new Date(Date.now() + 300000),
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });
    });

    it("should verify valid TOTP code", async () => {
      mockTotpService.verifyCodeForUser.mockResolvedValue("auth-id");

      const result = await service.verifyTotp(TEST_IDS.pendingId, "123456");

      expect(result.data.success).toBe(true);
      expect(result.data.userId).toBe(TEST_IDS.userId);
      expect(mockPendingTwoFactorRepository.deletePending).toHaveBeenCalled();
    });

    it("should return failure for invalid TOTP code", async () => {
      mockTotpService.verifyCodeForUser.mockResolvedValue(null);

      const result = await service.verifyTotp(TEST_IDS.pendingId, "000000");

      expect(result.data.success).toBe(false);
    });

    it("should throw BadRequestException after max attempts", async () => {
      mockPendingTwoFactorRepository.incrementAttemptCount.mockResolvedValue(6);

      await expect(service.verifyTotp(TEST_IDS.pendingId, "123456")).rejects.toThrow(BadRequestException);
      expect(mockPendingTwoFactorRepository.deletePending).toHaveBeenCalled();
    });

    it("should throw NotFoundException for missing pending session", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue(null);

      await expect(service.verifyTotp("non-existent", "123456")).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException for expired session", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "login",
          expiration: new Date(Date.now() - 60000), // Expired
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });

      await expect(service.verifyTotp(TEST_IDS.pendingId, "123456")).rejects.toThrow(BadRequestException);
    });
  });

  describe("verifyBackupCode", () => {
    beforeEach(() => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "login",
          expiration: new Date(Date.now() + 300000),
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });
    });

    it("should verify valid backup code", async () => {
      mockBackupCodeService.validateCode.mockResolvedValue(true);
      mockBackupCodeService.getRawUnusedCount.mockResolvedValue(9);

      const result = await service.verifyBackupCode(TEST_IDS.pendingId, "ABCD1234");

      expect(result.data.success).toBe(true);
      expect(mockPendingTwoFactorRepository.deletePending).toHaveBeenCalled();
    });

    it("should return failure for invalid backup code", async () => {
      mockBackupCodeService.validateCode.mockResolvedValue(false);

      const result = await service.verifyBackupCode(TEST_IDS.pendingId, "INVALID1");

      expect(result.data.success).toBe(false);
    });

    it("should throw BadRequestException after max attempts", async () => {
      mockPendingTwoFactorRepository.incrementAttemptCount.mockResolvedValue(4);

      await expect(service.verifyBackupCode(TEST_IDS.pendingId, "ABCD1234")).rejects.toThrow(BadRequestException);
    });
  });

  describe("getPendingSession", () => {
    it("should return pending session data", async () => {
      const pendingData = {
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "login",
          expiration: new Date(),
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      };
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue(pendingData);

      const result = await service.getPendingSession(TEST_IDS.pendingId);

      expect(result).toEqual(pendingData);
    });

    it("should return null when session not found", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue(null);

      const result = await service.getPendingSession("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("deletePendingSession", () => {
    it("should delete pending session", async () => {
      await service.deletePendingSession(TEST_IDS.pendingId);

      expect(mockPendingTwoFactorRepository.deletePending).toHaveBeenCalledWith({
        pendingId: TEST_IDS.pendingId,
      });
    });
  });

  describe("updateBackupCodesCount", () => {
    it("should update backup codes count in config", async () => {
      mockBackupCodeService.getRawUnusedCount.mockResolvedValue(7);
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue({
        id: TEST_IDS.configId,
      } as TwoFactorConfig);

      await service.updateBackupCodesCount(TEST_IDS.userId);

      expect(mockTwoFactorConfigRepository.updateByUserId).toHaveBeenCalledWith(
        expect.objectContaining({
          backupCodesCount: 7,
        }),
      );
    });

    it("should not update when user has no config", async () => {
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue(null);

      await service.updateBackupCodesCount(TEST_IDS.userId);

      expect(mockTwoFactorConfigRepository.updateByUserId).not.toHaveBeenCalled();
    });
  });

  describe("checkAndDisableIfNoMethods", () => {
    it("should disable 2FA when no methods remain", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(false);
      mockPasskeyService.hasPasskeys.mockResolvedValue(false);
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: true,
      } as TwoFactorConfig);

      const result = await service.checkAndDisableIfNoMethods(TEST_IDS.userId);

      expect(result).toBe(true);
      expect(mockTwoFactorConfigRepository.updateByUserId).toHaveBeenCalledWith(
        expect.objectContaining({
          isEnabled: false,
        }),
      );
    });

    it("should not disable when methods still available", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(true);

      const result = await service.checkAndDisableIfNoMethods(TEST_IDS.userId);

      expect(result).toBe(false);
    });

    it("should return false when 2FA already disabled", async () => {
      mockTotpService.hasVerifiedAuthenticator.mockResolvedValue(false);
      mockPasskeyService.hasPasskeys.mockResolvedValue(false);
      mockTwoFactorConfigRepository.findByUserId.mockResolvedValue({
        id: TEST_IDS.configId,
        isEnabled: false,
      } as TwoFactorConfig);

      const result = await service.checkAndDisableIfNoMethods(TEST_IDS.userId);

      expect(result).toBe(false);
    });
  });
});
