import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { BackupCodeService } from "../services/backup-code.service";
import { BackupCodeRepository } from "../repositories/backup-code.repository";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { BackupCode } from "../entities/backup-code";

/**
 * Real bcrypt, but at the minimum cost (4). The service hashes 10 codes per
 * generation at cost 10, which is ~1s of CPU per test and times out under a
 * full parallel run. The cost the service ASKS for is recorded so the spec
 * still pins the production value; compare() reads the cost off the hash.
 */
const { requestedRounds } = vi.hoisted(() => ({ requestedRounds: [] as Array<string | number> }));
vi.mock("bcrypt", async () => {
  const actual = await vi.importActual<typeof import("bcrypt")>("bcrypt");
  const hash = (data: string, rounds: string | number) => {
    requestedRounds.push(rounds);
    return actual.hash(data, 4);
  };
  return { ...actual, hash, default: { ...actual, hash } };
});

describe("BackupCodeService", () => {
  let service: BackupCodeService;
  let mockJsonApiService: Mocked<JsonApiService>;
  let mockBackupCodeRepository: Mocked<BackupCodeRepository>;

  const TEST_IDS = {
    userId: "user-123",
    codeId: "code-456",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    requestedRounds.length = 0;

    mockJsonApiService = {
      buildSingle: vi.fn().mockImplementation((model, data) => ({ data })),
      buildList: vi.fn().mockImplementation((model, data) => ({ data })),
    } as any;

    mockBackupCodeRepository = {
      createForUser: vi.fn().mockResolvedValue({ id: TEST_IDS.codeId }),
      findUnusedCount: vi.fn().mockResolvedValue(0),
      findUnusedByUserId: vi.fn().mockResolvedValue([]),
      findByUserId: vi.fn().mockResolvedValue([]),
      markUsed: vi.fn().mockResolvedValue(undefined),
      deleteAllByUserId: vi.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupCodeService,
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: BackupCodeRepository, useValue: mockBackupCodeRepository },
      ],
    }).compile();

    service = module.get<BackupCodeService>(BackupCodeService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateCodes", () => {
    it("should generate 10 backup codes", async () => {
      const result = await service.generateCodes({ userId: TEST_IDS.userId });

      expect(result.data).toHaveProperty("codes");
      expect(result.data.codes).toHaveLength(10);
      expect(result.data).toHaveProperty("count", 10);
    });

    it("should generate codes in correct format (8 hex characters)", async () => {
      const result = await service.generateCodes({ userId: TEST_IDS.userId });

      for (const code of result.data.codes) {
        expect(code).toMatch(/^[0-9A-F]{8}$/);
      }
    });

    it("should generate unique codes", async () => {
      const result = await service.generateCodes({ userId: TEST_IDS.userId });

      const uniqueCodes = new Set(result.data.codes);
      expect(uniqueCodes.size).toBe(10);
    });

    it("should store hashed codes in the database", async () => {
      await service.generateCodes({ userId: TEST_IDS.userId });

      expect(mockBackupCodeRepository.createForUser).toHaveBeenCalledTimes(10);
      // Verify that bcrypt hashes are passed (they start with $2)
      const callArgs = mockBackupCodeRepository.createForUser.mock.calls[0][0];
      expect(callArgs.codeHash).toMatch(/^\$2[aby]\$/);
      // Production cost factor is unchanged: every code is hashed at cost 10.
      expect(requestedRounds).toEqual(Array(10).fill(10));
    });

    it("should throw BadRequestException when user already has backup codes", async () => {
      mockBackupCodeRepository.findUnusedCount.mockResolvedValue(5);

      await expect(service.generateCodes({ userId: TEST_IDS.userId })).rejects.toThrow(BadRequestException);
    });
  });

  describe("validateCode", () => {
    it("should return true for valid backup code", async () => {
      // First generate codes to get a valid one
      const generateResult = await service.generateCodes({ userId: TEST_IDS.userId });
      const validCode = generateResult.data.codes[0];

      // Get the hash that was stored
      const storedHash = mockBackupCodeRepository.createForUser.mock.calls[0][0].codeHash;

      // Mock the repository to return this hash
      mockBackupCodeRepository.findUnusedByUserId.mockResolvedValue([
        { id: TEST_IDS.codeId, codeHash: storedHash, usedAt: null } as BackupCode,
      ]);

      const result = await service.validateCode({
        userId: TEST_IDS.userId,
        code: validCode,
      });

      expect(result).toBe(true);
      expect(mockBackupCodeRepository.markUsed).toHaveBeenCalledWith({ codeId: TEST_IDS.codeId });
    });

    it("should return false for invalid backup code", async () => {
      mockBackupCodeRepository.findUnusedByUserId.mockResolvedValue([
        { id: TEST_IDS.codeId, codeHash: "$2b$10$somehashedvalue", usedAt: null } as BackupCode,
      ]);

      const result = await service.validateCode({
        userId: TEST_IDS.userId,
        code: "INVALIDX",
      });

      expect(result).toBe(false);
      expect(mockBackupCodeRepository.markUsed).not.toHaveBeenCalled();
    });

    it("should return false for incorrectly formatted code", async () => {
      const result = await service.validateCode({
        userId: TEST_IDS.userId,
        code: "not-valid",
      });

      expect(result).toBe(false);
    });

    it("should normalize code (uppercase, remove dashes/spaces)", async () => {
      const generateResult = await service.generateCodes({ userId: TEST_IDS.userId });
      const validCode = generateResult.data.codes[0];
      const storedHash = mockBackupCodeRepository.createForUser.mock.calls[0][0].codeHash;

      mockBackupCodeRepository.findUnusedByUserId.mockResolvedValue([
        { id: TEST_IDS.codeId, codeHash: storedHash, usedAt: null } as BackupCode,
      ]);

      // Test with lowercase
      const result = await service.validateCode({
        userId: TEST_IDS.userId,
        code: validCode.toLowerCase(),
      });

      expect(result).toBe(true);
    });

    it("should return false when user has no backup codes", async () => {
      mockBackupCodeRepository.findUnusedByUserId.mockResolvedValue([]);

      const result = await service.validateCode({
        userId: TEST_IDS.userId,
        code: "ABCD1234",
      });

      expect(result).toBe(false);
    });
  });

  describe("getUnusedCount", () => {
    it("should return count of unused backup codes", async () => {
      mockBackupCodeRepository.findUnusedCount.mockResolvedValue(7);

      const result = await service.getUnusedCount({ userId: TEST_IDS.userId });

      expect(result.data).toHaveProperty("count", 7);
    });

    it("should return 0 when user has no backup codes", async () => {
      mockBackupCodeRepository.findUnusedCount.mockResolvedValue(0);

      const result = await service.getUnusedCount({ userId: TEST_IDS.userId });

      expect(result.data).toHaveProperty("count", 0);
    });
  });

  describe("getRawUnusedCount", () => {
    it("should return raw count number", async () => {
      mockBackupCodeRepository.findUnusedCount.mockResolvedValue(5);

      const result = await service.getRawUnusedCount({ userId: TEST_IDS.userId });

      expect(result).toBe(5);
    });
  });

  describe("regenerateCodes", () => {
    it("should delete existing codes and generate new ones", async () => {
      const result = await service.regenerateCodes({ userId: TEST_IDS.userId });

      expect(mockBackupCodeRepository.deleteAllByUserId).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(result.data).toHaveProperty("codes");
      expect(result.data.codes).toHaveLength(10);
    });

    it("should allow regeneration even when codes exist", async () => {
      // Unlike generateCodes, regenerateCodes should work even with existing codes
      mockBackupCodeRepository.findUnusedCount.mockResolvedValue(5);

      const result = await service.regenerateCodes({ userId: TEST_IDS.userId });

      expect(result.data).toHaveProperty("codes");
    });
  });

  describe("hasBackupCodes", () => {
    it("should return true when user has backup codes", async () => {
      mockBackupCodeRepository.findByUserId.mockResolvedValue([
        { id: "code-1", codeHash: "hash1", usedAt: null } as BackupCode,
        { id: "code-2", codeHash: "hash2", usedAt: new Date() } as BackupCode,
      ]);

      const result = await service.hasBackupCodes({ userId: TEST_IDS.userId });

      expect(result).toBe(true);
    });

    it("should return false when user has no backup codes", async () => {
      mockBackupCodeRepository.findByUserId.mockResolvedValue([]);

      const result = await service.hasBackupCodes({ userId: TEST_IDS.userId });

      expect(result).toBe(false);
    });
  });

  describe("deleteAllCodes", () => {
    it("should delete all backup codes for user", async () => {
      await service.deleteAllCodes({ userId: TEST_IDS.userId });

      expect(mockBackupCodeRepository.deleteAllByUserId).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
    });
  });

  describe("single-use enforcement", () => {
    it("should mark code as used after validation", async () => {
      const generateResult = await service.generateCodes({ userId: TEST_IDS.userId });
      const validCode = generateResult.data.codes[0];
      const storedHash = mockBackupCodeRepository.createForUser.mock.calls[0][0].codeHash;

      mockBackupCodeRepository.findUnusedByUserId.mockResolvedValue([
        { id: TEST_IDS.codeId, codeHash: storedHash, usedAt: null } as BackupCode,
      ]);

      await service.validateCode({
        userId: TEST_IDS.userId,
        code: validCode,
      });

      expect(mockBackupCodeRepository.markUsed).toHaveBeenCalledWith({ codeId: TEST_IDS.codeId });
    });

    it("should not return used codes in findUnusedByUserId", async () => {
      // This test verifies the expected behavior - used codes should not be returned
      // The actual filtering happens in the repository
      mockBackupCodeRepository.findUnusedByUserId.mockResolvedValue([]);

      const result = await service.validateCode({
        userId: TEST_IDS.userId,
        code: "AAAABBBB",
      });

      expect(result).toBe(false);
    });
  });

  describe("code format", () => {
    it("should generate codes with exactly 8 hex characters", async () => {
      const result = await service.generateCodes({ userId: TEST_IDS.userId });

      for (const code of result.data.codes) {
        expect(code.length).toBe(8);
        expect(code).toMatch(/^[0-9A-F]+$/);
      }
    });

    it("should generate codes in uppercase", async () => {
      const result = await service.generateCodes({ userId: TEST_IDS.userId });

      for (const code of result.data.codes) {
        expect(code).toBe(code.toUpperCase());
      }
    });
  });
});
