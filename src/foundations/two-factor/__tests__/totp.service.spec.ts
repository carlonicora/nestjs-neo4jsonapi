import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { TotpService } from "../services/totp.service";
import { TotpEncryptionService } from "../services/totp-encryption.service";
import { TotpAuthenticatorRepository } from "../repositories/totp-authenticator.repository";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import * as OTPAuth from "otpauth";

describe("TotpService", () => {
  let service: TotpService;
  let mockJsonApiService: vi.Mocked<JsonApiService>;
  let mockTotpAuthenticatorRepository: vi.Mocked<TotpAuthenticatorRepository>;
  let mockTotpEncryptionService: vi.Mocked<TotpEncryptionService>;

  const TEST_IDS = {
    userId: "user-123",
    authenticatorId: "auth-456",
  };

  const TEST_SECRETS = {
    plain: "JBSWY3DPEHPK3PXP",
    encrypted: "encrypted-secret-base64",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockJsonApiService = {
      buildSingle: vi.fn().mockImplementation((model, data) => ({ data })),
      buildList: vi.fn().mockImplementation((model, data) => ({ data })),
    } as any;

    mockTotpAuthenticatorRepository = {
      createForUser: vi.fn().mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        name: "Test Auth",
        verified: false,
        createdAt: new Date(),
      }),
      findByIdWithSecret: vi.fn(),
      findAllByUserIdWithSecrets: vi.fn().mockResolvedValue([]),
      findVerifiedByUserId: vi.fn().mockResolvedValue([]),
      findByIdForUser: vi.fn(),
      updateAuthenticator: vi.fn(),
      deleteAuthenticator: vi.fn().mockResolvedValue(undefined),
      countVerifiedByUserId: vi.fn().mockResolvedValue(0),
    } as any;

    mockTotpEncryptionService = {
      encrypt: vi.fn().mockReturnValue(TEST_SECRETS.encrypted),
      decrypt: vi.fn().mockReturnValue(TEST_SECRETS.plain),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TotpService,
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: TotpAuthenticatorRepository, useValue: mockTotpAuthenticatorRepository },
        { provide: TotpEncryptionService, useValue: mockTotpEncryptionService },
      ],
    }).compile();

    service = module.get<TotpService>(TotpService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateSecret", () => {
    it("should generate a new TOTP secret with QR code", async () => {
      const params = {
        userId: TEST_IDS.userId,
        name: "Google Authenticator",
        accountName: "test@example.com",
      };

      const result = await service.generateSecret(params);

      expect(result).toBeDefined();
      expect(result.data).toHaveProperty("id");
      expect(result.data).toHaveProperty("secret");
      expect(result.data).toHaveProperty("qrCodeUri");
      expect(result.data).toHaveProperty("qrCodeDataUrl");
      expect(result.data.qrCodeUri).toContain("otpauth://totp/");
      expect(result.data.qrCodeDataUrl).toContain("data:image/png;base64,");
    });

    it("should create authenticator in unverified state", async () => {
      const params = {
        userId: TEST_IDS.userId,
        name: "My Authenticator",
        accountName: "user@test.com",
      };

      await service.generateSecret(params);

      expect(mockTotpAuthenticatorRepository.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          name: "My Authenticator",
          verified: false,
        }),
      );
    });

    it("should encrypt the secret before storing", async () => {
      const params = {
        userId: TEST_IDS.userId,
        name: "Test Auth",
        accountName: "test@example.com",
      };

      await service.generateSecret(params);

      expect(mockTotpEncryptionService.encrypt).toHaveBeenCalled();
      expect(mockTotpAuthenticatorRepository.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          secret: TEST_SECRETS.encrypted,
        }),
      );
    });
  });

  describe("generateQRCodeUri", () => {
    it("should generate QR code for unverified authenticator", async () => {
      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        secret: TEST_SECRETS.encrypted,
        verified: false,
      });

      const result = await service.generateQRCodeUri({
        authenticatorId: TEST_IDS.authenticatorId,
        accountName: "test@example.com",
      });

      expect(result).toHaveProperty("qrCodeUri");
      expect(result).toHaveProperty("qrCodeDataUrl");
      expect(result.qrCodeUri).toContain("otpauth://totp/");
    });

    it("should throw NotFoundException when authenticator not found", async () => {
      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue(null);

      await expect(
        service.generateQRCodeUri({
          authenticatorId: "non-existent",
          accountName: "test@example.com",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException for verified authenticator", async () => {
      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        secret: TEST_SECRETS.encrypted,
        verified: true,
      });

      await expect(
        service.generateQRCodeUri({
          authenticatorId: TEST_IDS.authenticatorId,
          accountName: "test@example.com",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("verifyCode", () => {
    it("should return true for valid TOTP code", async () => {
      // Generate a real TOTP code for testing
      const secret = new OTPAuth.Secret({ size: 20 });
      const totp = new OTPAuth.TOTP({
        issuer: "Test Issuer",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: secret,
      });
      const validCode = totp.generate();

      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        secret: TEST_SECRETS.encrypted,
        verified: true,
      });
      mockTotpEncryptionService.decrypt.mockReturnValue(secret.base32);
      mockTotpAuthenticatorRepository.updateAuthenticator.mockResolvedValue({});

      const result = await service.verifyCode({
        authenticatorId: TEST_IDS.authenticatorId,
        code: validCode,
      });

      expect(result).toBe(true);
      expect(mockTotpAuthenticatorRepository.updateAuthenticator).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticatorId: TEST_IDS.authenticatorId,
          lastUsedAt: expect.any(Date),
        }),
      );
    });

    it("should return false for invalid TOTP code", async () => {
      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        secret: TEST_SECRETS.encrypted,
        verified: true,
      });

      const result = await service.verifyCode({
        authenticatorId: TEST_IDS.authenticatorId,
        code: "000000",
      });

      expect(result).toBe(false);
    });

    it("should throw NotFoundException when authenticator not found", async () => {
      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue(null);

      await expect(
        service.verifyCode({
          authenticatorId: "non-existent",
          code: "123456",
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("verifyCodeForUser", () => {
    it("should verify code against all user authenticators", async () => {
      const correctSecret = new OTPAuth.Secret({ size: 20 });
      const wrongSecret = new OTPAuth.Secret({ size: 20 }); // Generate another valid base32 secret
      const totp = new OTPAuth.TOTP({
        issuer: "Test Issuer",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: correctSecret,
      });
      const validCode = totp.generate();

      mockTotpAuthenticatorRepository.findAllByUserIdWithSecrets.mockResolvedValue([
        { id: "auth-1", secret: "encrypted-wrong", verified: true },
        { id: "auth-2", secret: TEST_SECRETS.encrypted, verified: true },
      ]);
      mockTotpEncryptionService.decrypt
        .mockReturnValueOnce(wrongSecret.base32) // First authenticator - wrong secret (but valid base32)
        .mockReturnValueOnce(correctSecret.base32); // Second authenticator - correct secret
      mockTotpAuthenticatorRepository.updateAuthenticator.mockResolvedValue({});

      const result = await service.verifyCodeForUser({
        userId: TEST_IDS.userId,
        code: validCode,
      });

      expect(result).toBe("auth-2");
    });

    it("should return null when no authenticator matches", async () => {
      mockTotpAuthenticatorRepository.findAllByUserIdWithSecrets.mockResolvedValue([
        { id: "auth-1", secret: TEST_SECRETS.encrypted, verified: true },
      ]);

      const result = await service.verifyCodeForUser({
        userId: TEST_IDS.userId,
        code: "000000",
      });

      expect(result).toBeNull();
    });

    it("should return null when user has no authenticators", async () => {
      mockTotpAuthenticatorRepository.findAllByUserIdWithSecrets.mockResolvedValue([]);

      const result = await service.verifyCodeForUser({
        userId: TEST_IDS.userId,
        code: "123456",
      });

      expect(result).toBeNull();
    });
  });

  describe("addAuthenticator", () => {
    it("should verify and mark authenticator as verified", async () => {
      const secret = new OTPAuth.Secret({ size: 20 });
      const totp = new OTPAuth.TOTP({
        issuer: "Test Issuer",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: secret,
      });
      const validCode = totp.generate();

      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        secret: TEST_SECRETS.encrypted,
        verified: false,
      });
      mockTotpEncryptionService.decrypt.mockReturnValue(secret.base32);
      mockTotpAuthenticatorRepository.updateAuthenticator.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        name: "Test Auth",
        verified: true,
      });

      const result = await service.addAuthenticator({
        authenticatorId: TEST_IDS.authenticatorId,
        code: validCode,
      });

      expect(result).toBeDefined();
      expect(mockTotpAuthenticatorRepository.updateAuthenticator).toHaveBeenCalledWith(
        expect.objectContaining({
          verified: true,
        }),
      );
    });

    it("should return null for invalid code", async () => {
      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        secret: TEST_SECRETS.encrypted,
        verified: false,
      });

      const result = await service.addAuthenticator({
        authenticatorId: TEST_IDS.authenticatorId,
        code: "000000",
      });

      expect(result).toBeNull();
    });

    it("should throw NotFoundException when authenticator not found", async () => {
      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue(null);

      await expect(
        service.addAuthenticator({
          authenticatorId: "non-existent",
          code: "123456",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when authenticator is already verified", async () => {
      mockTotpAuthenticatorRepository.findByIdWithSecret.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        secret: TEST_SECRETS.encrypted,
        verified: true,
      });

      await expect(
        service.addAuthenticator({
          authenticatorId: TEST_IDS.authenticatorId,
          code: "123456",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("removeAuthenticator", () => {
    it("should remove an existing authenticator", async () => {
      mockTotpAuthenticatorRepository.findByIdForUser.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
      });

      await service.removeAuthenticator({
        authenticatorId: TEST_IDS.authenticatorId,
      });

      expect(mockTotpAuthenticatorRepository.deleteAuthenticator).toHaveBeenCalledWith({
        authenticatorId: TEST_IDS.authenticatorId,
      });
    });

    it("should throw NotFoundException when authenticator not found", async () => {
      mockTotpAuthenticatorRepository.findByIdForUser.mockResolvedValue(null);

      await expect(
        service.removeAuthenticator({
          authenticatorId: "non-existent",
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("listAuthenticators", () => {
    it("should return all authenticators for a user", async () => {
      const authenticators = [
        { id: "auth-1", name: "Auth 1", verified: true },
        { id: "auth-2", name: "Auth 2", verified: false },
      ];
      mockTotpAuthenticatorRepository.findAllByUserIdWithSecrets.mockResolvedValue(authenticators);

      const result = await service.listAuthenticators({ userId: TEST_IDS.userId });

      expect(result).toBeDefined();
      expect(mockJsonApiService.buildList).toHaveBeenCalled();
    });

    it("should return only verified authenticators when verifiedOnly is true", async () => {
      const verifiedAuthenticators = [{ id: "auth-1", name: "Auth 1", verified: true }];
      mockTotpAuthenticatorRepository.findVerifiedByUserId.mockResolvedValue(verifiedAuthenticators);

      const result = await service.listAuthenticators({
        userId: TEST_IDS.userId,
        verifiedOnly: true,
      });

      expect(result).toBeDefined();
      expect(mockTotpAuthenticatorRepository.findVerifiedByUserId).toHaveBeenCalled();
    });
  });

  describe("hasVerifiedAuthenticator", () => {
    it("should return true when user has verified authenticators", async () => {
      mockTotpAuthenticatorRepository.countVerifiedByUserId.mockResolvedValue(2);

      const result = await service.hasVerifiedAuthenticator({ userId: TEST_IDS.userId });

      expect(result).toBe(true);
    });

    it("should return false when user has no verified authenticators", async () => {
      mockTotpAuthenticatorRepository.countVerifiedByUserId.mockResolvedValue(0);

      const result = await service.hasVerifiedAuthenticator({ userId: TEST_IDS.userId });

      expect(result).toBe(false);
    });
  });

  describe("deleteUnverifiedAuthenticator", () => {
    it("should delete an unverified authenticator", async () => {
      mockTotpAuthenticatorRepository.findByIdForUser.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        verified: false,
      });

      await service.deleteUnverifiedAuthenticator({
        authenticatorId: TEST_IDS.authenticatorId,
      });

      expect(mockTotpAuthenticatorRepository.deleteAuthenticator).toHaveBeenCalledWith({
        authenticatorId: TEST_IDS.authenticatorId,
      });
    });

    it("should throw NotFoundException when authenticator not found", async () => {
      mockTotpAuthenticatorRepository.findByIdForUser.mockResolvedValue(null);

      await expect(
        service.deleteUnverifiedAuthenticator({
          authenticatorId: "non-existent",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when authenticator is verified", async () => {
      mockTotpAuthenticatorRepository.findByIdForUser.mockResolvedValue({
        id: TEST_IDS.authenticatorId,
        verified: true,
      });

      await expect(
        service.deleteUnverifiedAuthenticator({
          authenticatorId: TEST_IDS.authenticatorId,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
