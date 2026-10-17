import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { PasskeyService } from "../services/passkey.service";
import { PasskeyRepository } from "../repositories/passkey.repository";
import { PendingTwoFactorRepository } from "../repositories/pending-two-factor.repository";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { PendingTwoFactor } from "../entities/pending-two-factor";
import { Passkey } from "../entities/passkey";

// Mock baseConfig
vi.mock("../../../config/base.config", () => ({
  baseConfig: {
    twoFactor: {
      webauthnRpId: "localhost",
      webauthnRpName: "Test App",
      webauthnOrigin: "http://localhost:3000",
    },
  },
}));

// Mock @simplewebauthn/server
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: "test-challenge-base64url",
    rp: { name: "Test App", id: "localhost" },
    user: { id: "dXNlci0xMjM", name: "test@example.com", displayName: "Test User" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 60000,
    attestation: "none",
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: "test-auth-challenge",
    rpId: "localhost",
    allowCredentials: [],
    timeout: 60000,
  }),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

describe("PasskeyService", () => {
  let service: PasskeyService;
  let mockJsonApiService: Mocked<JsonApiService>;
  let mockPasskeyRepository: Mocked<PasskeyRepository>;
  let mockPendingTwoFactorRepository: Mocked<PendingTwoFactorRepository>;

  const TEST_IDS = {
    userId: "user-123",
    passkeyId: "passkey-456",
    pendingId: "pending-789",
  };

  const TEST_CREDENTIAL = {
    credentialId: "Y3JlZGVudGlhbC1pZA",
    publicKey: "cHVibGljLWtleQ",
    counter: 0,
    transports: '["internal"]',
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockJsonApiService = {
      buildSingle: vi.fn().mockImplementation((model, data) => ({ data })),
      buildList: vi.fn().mockImplementation((model, data) => ({ data })),
    } as any;

    mockPasskeyRepository = {
      createForUser: vi.fn().mockResolvedValue({
        id: TEST_IDS.passkeyId,
        name: "Test Passkey",
        ...TEST_CREDENTIAL,
        backedUp: false,
        createdAt: new Date(),
      }),
      findAllByUserIdWithCredentials: vi.fn().mockResolvedValue([]),
      findByUserId: vi.fn().mockResolvedValue([]),
      findByIdForUser: vi.fn(),
      findByCredentialId: vi.fn(),
      updatePasskey: vi.fn().mockResolvedValue({}),
      deletePasskey: vi.fn().mockResolvedValue(undefined),
      countByUserId: vi.fn().mockResolvedValue(0),
    } as any;

    mockPendingTwoFactorRepository = {
      createForUser: vi.fn().mockResolvedValue({
        id: TEST_IDS.pendingId,
        challenge: "test-challenge",
        challengeType: "passkey-registration",
        expiration: new Date(Date.now() + 300000),
      }),
      findByIdWithUser: vi.fn(),
      deletePending: vi.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasskeyService,
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: PasskeyRepository, useValue: mockPasskeyRepository },
        { provide: PendingTwoFactorRepository, useValue: mockPendingTwoFactorRepository },
      ],
    }).compile();

    service = module.get<PasskeyService>(PasskeyService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateRegistrationOptions", () => {
    it("should generate registration options for new passkey", async () => {
      const result = await service.generateRegistrationOptions({
        userId: TEST_IDS.userId,
        userName: "test@example.com",
        userDisplayName: "Test User",
      });

      expect(result).toBeDefined();
      expect(result.data).toHaveProperty("pendingId");
      expect(result.data).toHaveProperty("options");
    });

    it("should store challenge in pending repository", async () => {
      await service.generateRegistrationOptions({
        userId: TEST_IDS.userId,
        userName: "test@example.com",
        userDisplayName: "Test User",
      });

      expect(mockPendingTwoFactorRepository.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          challengeType: "passkey-registration",
        }),
      );
    });

    it("should exclude existing passkeys from registration", async () => {
      mockPasskeyRepository.findAllByUserIdWithCredentials.mockResolvedValue([
        { id: "existing-1", credentialId: "cred-1", transports: '["internal"]' } as Passkey,
      ]);

      await service.generateRegistrationOptions({
        userId: TEST_IDS.userId,
        userName: "test@example.com",
        userDisplayName: "Test User",
      });

      const { generateRegistrationOptions } = await import("@simplewebauthn/server");
      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [
            expect.objectContaining({
              id: "cred-1",
              type: "public-key",
            }),
          ],
        }),
      );
    });
  });

  describe("verifyRegistration", () => {
    const mockRegistrationResponse = {
      id: "Y3JlZGVudGlhbC1pZA",
      rawId: "Y3JlZGVudGlhbC1pZA",
      type: "public-key" as const,
      response: {
        clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
        attestationObject: "o2NmbXRkbm9uZQ",
        transports: ["internal" as const],
      },
      clientExtensionResults: {},
    };

    beforeEach(async () => {
      const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
      (verifyRegistrationResponse as any).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: new Uint8Array([1, 2, 3]),
            publicKey: new Uint8Array([4, 5, 6]),
            counter: 0,
          },
          credentialBackedUp: false,
        },
      });
    });

    it("should verify registration and create passkey", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "passkey-registration",
          expiration: new Date(Date.now() + 300000),
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });

      const result = await service.verifyRegistration({
        pendingId: TEST_IDS.pendingId,
        name: "My Passkey",
        response: mockRegistrationResponse,
      });

      expect(result).toBeDefined();
      expect(mockPasskeyRepository.createForUser).toHaveBeenCalled();
      expect(mockPendingTwoFactorRepository.deletePending).toHaveBeenCalledWith({
        pendingId: TEST_IDS.pendingId,
      });
    });

    it("should throw NotFoundException when pending challenge not found", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue(null);

      await expect(
        service.verifyRegistration({
          pendingId: "non-existent",
          name: "My Passkey",
          response: mockRegistrationResponse,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException for wrong challenge type", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "login", // Wrong type
          expiration: new Date(Date.now() + 300000),
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });

      await expect(
        service.verifyRegistration({
          pendingId: TEST_IDS.pendingId,
          name: "My Passkey",
          response: mockRegistrationResponse,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for expired challenge", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "passkey-registration",
          expiration: new Date(Date.now() - 60000), // Expired
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });

      await expect(
        service.verifyRegistration({
          pendingId: TEST_IDS.pendingId,
          name: "My Passkey",
          response: mockRegistrationResponse,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when verification fails", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "passkey-registration",
          expiration: new Date(Date.now() + 300000),
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });

      const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
      (verifyRegistrationResponse as any).mockResolvedValue({
        verified: false,
        registrationInfo: null,
      });

      await expect(
        service.verifyRegistration({
          pendingId: TEST_IDS.pendingId,
          name: "My Passkey",
          response: mockRegistrationResponse,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("generateAuthenticationOptions", () => {
    it("should generate authentication options", async () => {
      mockPasskeyRepository.findAllByUserIdWithCredentials.mockResolvedValue([
        { id: TEST_IDS.passkeyId, ...TEST_CREDENTIAL } as Passkey,
      ]);

      const result = await service.generateAuthenticationOptions({ userId: TEST_IDS.userId });

      expect(result).toBeDefined();
      expect(result.data).toHaveProperty("pendingId");
      expect(result.data).toHaveProperty("options");
    });

    it("should throw BadRequestException when user has no passkeys", async () => {
      mockPasskeyRepository.findAllByUserIdWithCredentials.mockResolvedValue([]);

      await expect(service.generateAuthenticationOptions({ userId: TEST_IDS.userId })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should include user passkeys in allowCredentials", async () => {
      mockPasskeyRepository.findAllByUserIdWithCredentials.mockResolvedValue([
        { id: "pk-1", credentialId: "cred-1", transports: '["internal"]' } as Passkey,
        { id: "pk-2", credentialId: "cred-2", transports: '["usb"]' } as Passkey,
      ]);

      await service.generateAuthenticationOptions({ userId: TEST_IDS.userId });

      const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
      expect(generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: [expect.objectContaining({ id: "cred-1" }), expect.objectContaining({ id: "cred-2" })],
        }),
      );
    });
  });

  describe("verifyAuthentication", () => {
    const mockAuthResponse = {
      id: "Y3JlZGVudGlhbC1pZA",
      rawId: "Y3JlZGVudGlhbC1pZA",
      type: "public-key" as const,
      response: {
        clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
        authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2M",
        signature: "MEUCIQDKZoqzW...",
      },
      clientExtensionResults: {},
    };

    beforeEach(async () => {
      const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
      (verifyAuthenticationResponse as any).mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 1,
        },
      });
    });

    it("should verify authentication and return passkey ID", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "passkey-authentication",
          expiration: new Date(Date.now() + 300000),
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });

      mockPasskeyRepository.findByCredentialId.mockResolvedValue({
        id: TEST_IDS.passkeyId,
        ...TEST_CREDENTIAL,
      } as Passkey);

      const result = await service.verifyAuthentication({
        pendingId: TEST_IDS.pendingId,
        response: mockAuthResponse,
      });

      expect(result).toBe(TEST_IDS.passkeyId);
      expect(mockPasskeyRepository.updatePasskey).toHaveBeenCalledWith(
        expect.objectContaining({
          passkeyId: TEST_IDS.passkeyId,
          counter: 1,
          lastUsedAt: expect.any(Date),
        }),
      );
    });

    it("should throw NotFoundException when pending challenge not found", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue(null);

      await expect(
        service.verifyAuthentication({
          pendingId: "non-existent",
          response: mockAuthResponse,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when passkey not found", async () => {
      mockPendingTwoFactorRepository.findByIdWithUser.mockResolvedValue({
        pending: {
          id: TEST_IDS.pendingId,
          challenge: "test-challenge",
          challengeType: "passkey-authentication",
          expiration: new Date(Date.now() + 300000),
        } as PendingTwoFactor,
        userId: TEST_IDS.userId,
      });

      mockPasskeyRepository.findByCredentialId.mockResolvedValue(null);

      await expect(
        service.verifyAuthentication({
          pendingId: TEST_IDS.pendingId,
          response: mockAuthResponse,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("listPasskeys", () => {
    it("should return all passkeys for user", async () => {
      const passkeys = [
        { id: "pk-1", name: "Passkey 1", backedUp: true },
        { id: "pk-2", name: "Passkey 2", backedUp: false },
      ] as Passkey[];
      mockPasskeyRepository.findByUserId.mockResolvedValue(passkeys);

      const result = await service.listPasskeys({ userId: TEST_IDS.userId });

      expect(result).toBeDefined();
      expect(mockJsonApiService.buildList).toHaveBeenCalled();
    });
  });

  describe("removePasskey", () => {
    it("should remove an existing passkey", async () => {
      mockPasskeyRepository.findByIdForUser.mockResolvedValue({ id: TEST_IDS.passkeyId } as Passkey);

      await service.removePasskey({ passkeyId: TEST_IDS.passkeyId });

      expect(mockPasskeyRepository.deletePasskey).toHaveBeenCalledWith({ passkeyId: TEST_IDS.passkeyId });
    });

    it("should throw NotFoundException when passkey not found", async () => {
      mockPasskeyRepository.findByIdForUser.mockResolvedValue(null);

      await expect(service.removePasskey({ passkeyId: "non-existent" })).rejects.toThrow(NotFoundException);
    });
  });

  describe("renamePasskey", () => {
    it("should rename a passkey", async () => {
      mockPasskeyRepository.findByIdForUser.mockResolvedValue({ id: TEST_IDS.passkeyId, name: "Old Name" } as Passkey);

      await service.renamePasskey({ passkeyId: TEST_IDS.passkeyId, name: "New Name" });

      expect(mockPasskeyRepository.updatePasskey).toHaveBeenCalledWith({
        passkeyId: TEST_IDS.passkeyId,
        name: "New Name",
      });
    });

    it("should throw NotFoundException when passkey not found", async () => {
      mockPasskeyRepository.findByIdForUser.mockResolvedValue(null);

      await expect(service.renamePasskey({ passkeyId: "non-existent", name: "New Name" })).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException for empty name", async () => {
      mockPasskeyRepository.findByIdForUser.mockResolvedValue({ id: TEST_IDS.passkeyId } as Passkey);

      await expect(service.renamePasskey({ passkeyId: TEST_IDS.passkeyId, name: "" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should trim whitespace from name", async () => {
      mockPasskeyRepository.findByIdForUser.mockResolvedValue({ id: TEST_IDS.passkeyId } as Passkey);

      await service.renamePasskey({ passkeyId: TEST_IDS.passkeyId, name: "  My Passkey  " });

      expect(mockPasskeyRepository.updatePasskey).toHaveBeenCalledWith({
        passkeyId: TEST_IDS.passkeyId,
        name: "My Passkey",
      });
    });
  });

  describe("hasPasskeys", () => {
    it("should return true when user has passkeys", async () => {
      mockPasskeyRepository.countByUserId.mockResolvedValue(2);

      const result = await service.hasPasskeys({ userId: TEST_IDS.userId });

      expect(result).toBe(true);
    });

    it("should return false when user has no passkeys", async () => {
      mockPasskeyRepository.countByUserId.mockResolvedValue(0);

      const result = await service.hasPasskeys({ userId: TEST_IDS.userId });

      expect(result).toBe(false);
    });
  });
});
