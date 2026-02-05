/**
 * ReferralService Unit Tests
 *
 * Tests service behavior with configuration injection,
 * including feature enabled/disabled behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { ClsService } from "nestjs-cls";
import { Queue } from "bullmq";

import { ReferralService } from "../services/referral.service";
import { ReferralRepository } from "../repositories/referral.repository";
import {
  DEFAULT_REFERRAL_CONFIG,
  REFERRAL_CONFIG,
  ReferralModuleConfig,
} from "../interfaces/referral.config.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { CacheService } from "../../../core/cache/services/cache.service";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { UserRepository } from "../../user/repositories/user.repository";
import { QueueId } from "../../../config/enums/queue.id";

describe("ReferralService", () => {
  let service: ReferralService;
  let mockConfig: Required<ReferralModuleConfig>;
  let mockJsonApiService: vi.Mocked<JsonApiService>;
  let mockReferralRepository: vi.Mocked<ReferralRepository>;
  let mockCompanyRepository: vi.Mocked<CompanyRepository>;
  let mockUserRepository: vi.Mocked<UserRepository>;
  let mockClsService: vi.Mocked<ClsService>;
  let mockCacheService: vi.Mocked<CacheService>;
  let mockEmailQueue: vi.Mocked<Queue>;
  let mockRedisClient: { get: vi.Mock; setex: vi.Mock };

  const MOCK_COMPANY_ID = "company-123";
  const MOCK_USER_ID = "user-456";
  const MOCK_REFERRAL_CODE = "ref-code-789";
  const MOCK_REFERRER_COMPANY_ID = "referrer-company-001";

  beforeEach(async () => {
    mockConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: true };

    mockRedisClient = {
      get: vi.fn(),
      setex: vi.fn(),
    };

    mockJsonApiService = {
      buildSingle: vi.fn(),
      buildList: vi.fn(),
    } as any;

    mockReferralRepository = {
      createReferral: vi.fn(),
      findPendingByReferredCompanyId: vi.fn(),
      completeReferral: vi.fn(),
      countCompletedByReferrerCompanyId: vi.fn(),
    } as any;

    mockCompanyRepository = {
      findByCompanyId: vi.fn(),
      findByReferralCode: vi.fn(),
      setReferralCode: vi.fn(),
      addExtraTokens: vi.fn(),
    } as any;

    mockUserRepository = {
      findByUserId: vi.fn(),
      findByEmail: vi.fn(),
    } as any;

    mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    } as any;

    mockCacheService = {
      getRedisClient: vi.fn().mockReturnValue(mockRedisClient),
    } as any;

    mockEmailQueue = {
      add: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralService,
        { provide: REFERRAL_CONFIG, useValue: mockConfig },
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: ReferralRepository, useValue: mockReferralRepository },
        { provide: CompanyRepository, useValue: mockCompanyRepository },
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: ClsService, useValue: mockClsService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getQueueToken(QueueId.EMAIL), useValue: mockEmailQueue },
      ],
    }).compile();

    service = module.get<ReferralService>(ReferralService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("isEnabled getter", () => {
    it("should return true when config.enabled is true", () => {
      expect(service.isEnabled).toBe(true);
    });

    it("should return false when config.enabled is false", async () => {
      mockConfig.enabled = false;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: REFERRAL_CONFIG, useValue: mockConfig },
          { provide: JsonApiService, useValue: mockJsonApiService },
          { provide: ReferralRepository, useValue: mockReferralRepository },
          { provide: CompanyRepository, useValue: mockCompanyRepository },
          { provide: UserRepository, useValue: mockUserRepository },
          { provide: ClsService, useValue: mockClsService },
          { provide: CacheService, useValue: mockCacheService },
          { provide: getQueueToken(QueueId.EMAIL), useValue: mockEmailQueue },
        ],
      }).compile();

      const disabledService = module.get<ReferralService>(ReferralService);
      expect(disabledService.isEnabled).toBe(false);
    });
  });

  describe("Scenario: Feature disabled behavior", () => {
    beforeEach(async () => {
      mockConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: false };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: REFERRAL_CONFIG, useValue: mockConfig },
          { provide: JsonApiService, useValue: mockJsonApiService },
          { provide: ReferralRepository, useValue: mockReferralRepository },
          { provide: CompanyRepository, useValue: mockCompanyRepository },
          { provide: UserRepository, useValue: mockUserRepository },
          { provide: ClsService, useValue: mockClsService },
          { provide: CacheService, useValue: mockCacheService },
          { provide: getQueueToken(QueueId.EMAIL), useValue: mockEmailQueue },
        ],
      }).compile();

      service = module.get<ReferralService>(ReferralService);
    });

    it("should skip tracking when disabled", async () => {
      await service.trackReferral({ referralCode: "some-code" });

      expect(mockCompanyRepository.findByReferralCode).not.toHaveBeenCalled();
      expect(mockReferralRepository.createReferral).not.toHaveBeenCalled();
    });

    it("should skip completion when disabled", async () => {
      await service.completeReferralOnPayment({ referredCompanyId: "company-1" });

      expect(mockReferralRepository.findPendingByReferredCompanyId).not.toHaveBeenCalled();
      expect(mockCompanyRepository.addExtraTokens).not.toHaveBeenCalled();
    });

    it("should not throw error when trackReferral is called while disabled", async () => {
      await expect(service.trackReferral({ referralCode: "any-code" })).resolves.not.toThrow();
    });

    it("should not throw error when completeReferralOnPayment is called while disabled", async () => {
      await expect(service.completeReferralOnPayment({ referredCompanyId: "any-company" })).resolves.not.toThrow();
    });
  });

  describe("Scenario: Feature enabled behavior", () => {
    describe("trackReferral", () => {
      beforeEach(() => {
        mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);
      });

      it("should track referral when enabled and code is valid", async () => {
        mockCompanyRepository.findByReferralCode.mockResolvedValue({
          id: MOCK_REFERRER_COMPANY_ID,
        } as any);
        mockReferralRepository.createReferral.mockResolvedValue();

        await service.trackReferral({ referralCode: MOCK_REFERRAL_CODE });

        expect(mockCompanyRepository.findByReferralCode).toHaveBeenCalledWith({
          referralCode: MOCK_REFERRAL_CODE,
        });
        expect(mockReferralRepository.createReferral).toHaveBeenCalledWith(
          expect.objectContaining({
            referrerCompanyId: MOCK_REFERRER_COMPANY_ID,
            referredCompanyId: MOCK_COMPANY_ID,
          }),
        );
      });

      it("should silently ignore invalid referral codes", async () => {
        mockCompanyRepository.findByReferralCode.mockResolvedValue(null);

        await service.trackReferral({ referralCode: "invalid-code" });

        expect(mockReferralRepository.createReferral).not.toHaveBeenCalled();
      });

      it("should prevent self-referral", async () => {
        // Referrer company has same ID as current company
        mockCompanyRepository.findByReferralCode.mockResolvedValue({
          id: MOCK_COMPANY_ID,
        } as any);

        await service.trackReferral({ referralCode: MOCK_REFERRAL_CODE });

        expect(mockReferralRepository.createReferral).not.toHaveBeenCalled();
      });

      it("should generate a unique referral ID", async () => {
        mockCompanyRepository.findByReferralCode.mockResolvedValue({
          id: MOCK_REFERRER_COMPANY_ID,
        } as any);
        mockReferralRepository.createReferral.mockResolvedValue();

        await service.trackReferral({ referralCode: MOCK_REFERRAL_CODE });

        expect(mockReferralRepository.createReferral).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.any(String),
          }),
        );
      });
    });

    describe("completeReferralOnPayment", () => {
      const mockReferral = {
        id: "referral-123",
        referrer: { id: MOCK_REFERRER_COMPANY_ID },
      };

      it("should complete referral and award tokens to both companies", async () => {
        mockReferralRepository.findPendingByReferredCompanyId.mockResolvedValue(mockReferral as any);
        mockCompanyRepository.addExtraTokens.mockResolvedValue();
        mockReferralRepository.completeReferral.mockResolvedValue();

        await service.completeReferralOnPayment({ referredCompanyId: MOCK_COMPANY_ID });

        // Referrer gets tokens
        expect(mockCompanyRepository.addExtraTokens).toHaveBeenCalledWith({
          companyId: MOCK_REFERRER_COMPANY_ID,
          tokens: 1000, // default rewardTokens
        });

        // Referred gets tokens
        expect(mockCompanyRepository.addExtraTokens).toHaveBeenCalledWith({
          companyId: MOCK_COMPANY_ID,
          tokens: 1000,
        });

        // Referral marked as completed
        expect(mockReferralRepository.completeReferral).toHaveBeenCalledWith({
          referralId: "referral-123",
          tokensAwarded: 1000,
        });
      });

      it("should use configured rewardTokens amount", async () => {
        mockConfig.rewardTokens = 2500;
        mockReferralRepository.findPendingByReferredCompanyId.mockResolvedValue(mockReferral as any);
        mockCompanyRepository.addExtraTokens.mockResolvedValue();
        mockReferralRepository.completeReferral.mockResolvedValue();

        await service.completeReferralOnPayment({ referredCompanyId: MOCK_COMPANY_ID });

        expect(mockCompanyRepository.addExtraTokens).toHaveBeenCalledWith(expect.objectContaining({ tokens: 2500 }));
      });

      it("should silently return when no pending referral found", async () => {
        mockReferralRepository.findPendingByReferredCompanyId.mockResolvedValue(null);

        await service.completeReferralOnPayment({ referredCompanyId: MOCK_COMPANY_ID });

        expect(mockCompanyRepository.addExtraTokens).not.toHaveBeenCalled();
        expect(mockReferralRepository.completeReferral).not.toHaveBeenCalled();
      });

      it("should handle referral without referrer company", async () => {
        const referralWithoutReferrer = {
          id: "referral-456",
          referrer: null,
        };
        mockReferralRepository.findPendingByReferredCompanyId.mockResolvedValue(referralWithoutReferrer as any);
        mockCompanyRepository.addExtraTokens.mockResolvedValue();
        mockReferralRepository.completeReferral.mockResolvedValue();

        await service.completeReferralOnPayment({ referredCompanyId: MOCK_COMPANY_ID });

        // Should still award to referred company
        expect(mockCompanyRepository.addExtraTokens).toHaveBeenCalledTimes(1);
        expect(mockCompanyRepository.addExtraTokens).toHaveBeenCalledWith({
          companyId: MOCK_COMPANY_ID,
          tokens: 1000,
        });
      });
    });

    describe("getOrCreateReferralCode", () => {
      beforeEach(() => {
        mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);
      });

      it("should return existing referral code if company has one", async () => {
        mockCompanyRepository.findByCompanyId.mockResolvedValue({
          referralCode: MOCK_REFERRAL_CODE,
        } as any);

        const result = await service.getOrCreateReferralCode();

        expect(result).toBe(MOCK_REFERRAL_CODE);
        expect(mockCompanyRepository.setReferralCode).not.toHaveBeenCalled();
      });

      it("should generate and save new code if company has none", async () => {
        mockCompanyRepository.findByCompanyId.mockResolvedValue({
          referralCode: null,
        } as any);
        mockCompanyRepository.setReferralCode.mockResolvedValue();

        const result = await service.getOrCreateReferralCode();

        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
        expect(mockCompanyRepository.setReferralCode).toHaveBeenCalledWith({
          companyId: MOCK_COMPANY_ID,
          referralCode: expect.any(String),
        });
      });
    });

    describe("sendReferralInvite", () => {
      const testEmail = "test@example.com";
      const mockCompany = {
        id: MOCK_COMPANY_ID,
        name: "Test Company",
        referralCode: MOCK_REFERRAL_CODE,
      };
      const mockUser = {
        id: MOCK_USER_ID,
        name: "Test User",
        email: "user@company.com",
      };

      beforeEach(() => {
        mockClsService.get.mockImplementation((key: string) => {
          if (key === "companyId") return MOCK_COMPANY_ID;
          if (key === "userId") return MOCK_USER_ID;
          return undefined;
        });
        mockRedisClient.get.mockResolvedValue(null);
        mockUserRepository.findByEmail.mockResolvedValue(null);
        mockCompanyRepository.findByCompanyId.mockResolvedValue(mockCompany as any);
        mockUserRepository.findByUserId.mockResolvedValue(mockUser as any);
        mockRedisClient.setex.mockResolvedValue("OK");
        mockEmailQueue.add.mockResolvedValue({} as any);
      });

      it("should send invite email when no cooldown exists", async () => {
        await service.sendReferralInvite({ email: testEmail });

        expect(mockEmailQueue.add).toHaveBeenCalledWith(
          "referral-invite",
          expect.objectContaining({
            jobType: "referral-invite",
            payload: expect.objectContaining({
              to: testEmail,
              referralCode: MOCK_REFERRAL_CODE,
              companyName: "Test Company",
              inviterName: "Test User",
            }),
          }),
        );
      });

      it("should throw BadRequestException when email already invited recently", async () => {
        mockRedisClient.get.mockResolvedValue("1");

        await expect(service.sendReferralInvite({ email: testEmail })).rejects.toThrow(BadRequestException);
        expect(mockEmailQueue.add).not.toHaveBeenCalled();
      });

      it("should throw BadRequestException when email is already registered", async () => {
        mockUserRepository.findByEmail.mockResolvedValue({ id: "existing-user" } as any);

        await expect(service.sendReferralInvite({ email: testEmail })).rejects.toThrow(BadRequestException);
        expect(mockEmailQueue.add).not.toHaveBeenCalled();
      });

      it("should set Redis key with configured cooldown TTL", async () => {
        mockConfig.inviteCooldownSeconds = 7200; // 2 hours

        await service.sendReferralInvite({ email: testEmail });

        expect(mockRedisClient.setex).toHaveBeenCalledWith(expect.any(String), 7200, "1");
      });

      it("should generate referral code if company does not have one", async () => {
        mockCompanyRepository.findByCompanyId.mockResolvedValue({
          ...mockCompany,
          referralCode: null,
        } as any);
        mockCompanyRepository.setReferralCode.mockResolvedValue();

        await service.sendReferralInvite({ email: testEmail });

        expect(mockCompanyRepository.setReferralCode).toHaveBeenCalled();
        expect(mockEmailQueue.add).toHaveBeenCalled();
      });

      it("should build referral URL using APP_URL environment variable", async () => {
        const originalAppUrl = process.env.APP_URL;
        process.env.APP_URL = "https://example.com";

        await service.sendReferralInvite({ email: testEmail });

        expect(mockEmailQueue.add).toHaveBeenCalledWith(
          "referral-invite",
          expect.objectContaining({
            payload: expect.objectContaining({
              referralUrl: `https://example.com/register?ref=${MOCK_REFERRAL_CODE}`,
            }),
          }),
        );

        process.env.APP_URL = originalAppUrl;
      });
    });

    describe("getStats", () => {
      beforeEach(() => {
        mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);
      });

      it("should return referral statistics", async () => {
        mockCompanyRepository.findByCompanyId.mockResolvedValue({
          id: MOCK_COMPANY_ID,
          referralCode: MOCK_REFERRAL_CODE,
        } as any);
        mockReferralRepository.countCompletedByReferrerCompanyId.mockResolvedValue(5);

        const stats = await service.getStats();

        expect(stats).toEqual({
          referralCode: MOCK_REFERRAL_CODE,
          completedReferrals: 5,
          totalTokensEarned: 5000, // 5 * 1000 default tokens
        });
      });

      it("should calculate totalTokensEarned using configured rewardTokens", async () => {
        mockConfig.rewardTokens = 2000;
        mockCompanyRepository.findByCompanyId.mockResolvedValue({
          id: MOCK_COMPANY_ID,
          referralCode: MOCK_REFERRAL_CODE,
        } as any);
        mockReferralRepository.countCompletedByReferrerCompanyId.mockResolvedValue(3);

        const stats = await service.getStats();

        expect(stats.totalTokensEarned).toBe(6000); // 3 * 2000
      });

      it("should throw NotFoundException when company not found", async () => {
        mockCompanyRepository.findByCompanyId.mockResolvedValue(null);

        await expect(service.getStats()).rejects.toThrow(NotFoundException);
      });

      it("should generate referral code if company does not have one", async () => {
        mockCompanyRepository.findByCompanyId.mockResolvedValue({
          id: MOCK_COMPANY_ID,
          referralCode: null,
        } as any);
        mockCompanyRepository.setReferralCode.mockResolvedValue();
        mockReferralRepository.countCompletedByReferrerCompanyId.mockResolvedValue(0);

        const stats = await service.getStats();

        expect(stats.referralCode).toBeDefined();
        expect(mockCompanyRepository.setReferralCode).toHaveBeenCalled();
      });
    });

    describe("getMyCodeJsonApi", () => {
      beforeEach(() => {
        mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);
      });

      it("should return JSON:API formatted referral code response", async () => {
        const mockJsonResponse = { data: { type: "referral-codes", id: MOCK_COMPANY_ID } };
        mockCompanyRepository.findByCompanyId.mockResolvedValue({
          referralCode: MOCK_REFERRAL_CODE,
        } as any);
        mockJsonApiService.buildSingle.mockResolvedValue(mockJsonResponse);

        const result = await service.getMyCodeJsonApi();

        expect(mockJsonApiService.buildSingle).toHaveBeenCalled();
        expect(result).toEqual(mockJsonResponse);
      });
    });

    describe("getStatsJsonApi", () => {
      beforeEach(() => {
        mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);
      });

      it("should return JSON:API formatted stats response", async () => {
        const mockJsonResponse = { data: { type: "referral-stats", id: MOCK_COMPANY_ID } };
        mockCompanyRepository.findByCompanyId.mockResolvedValue({
          id: MOCK_COMPANY_ID,
          referralCode: MOCK_REFERRAL_CODE,
        } as any);
        mockReferralRepository.countCompletedByReferrerCompanyId.mockResolvedValue(2);
        mockJsonApiService.buildSingle.mockResolvedValue(mockJsonResponse);

        const result = await service.getStatsJsonApi();

        expect(mockJsonApiService.buildSingle).toHaveBeenCalled();
        expect(result).toEqual(mockJsonResponse);
      });
    });
  });

  describe("Scenario: Service uses injected configuration", () => {
    it("should use default inviteCooldownSeconds when not overridden", () => {
      const defaultConfig = { ...DEFAULT_REFERRAL_CONFIG };
      expect(defaultConfig.inviteCooldownSeconds).toBe(14 * 24 * 60 * 60);
    });

    it("should use custom inviteCooldownSeconds when provided", async () => {
      const customConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: true, inviteCooldownSeconds: 3600 };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: REFERRAL_CONFIG, useValue: customConfig },
          { provide: JsonApiService, useValue: mockJsonApiService },
          { provide: ReferralRepository, useValue: mockReferralRepository },
          { provide: CompanyRepository, useValue: mockCompanyRepository },
          { provide: UserRepository, useValue: mockUserRepository },
          { provide: ClsService, useValue: mockClsService },
          { provide: CacheService, useValue: mockCacheService },
          { provide: getQueueToken(QueueId.EMAIL), useValue: mockEmailQueue },
        ],
      }).compile();

      const customService = module.get<ReferralService>(ReferralService);

      // Setup mocks for sendReferralInvite
      mockClsService.get.mockImplementation((key: string) => {
        if (key === "companyId") return MOCK_COMPANY_ID;
        if (key === "userId") return MOCK_USER_ID;
        return undefined;
      });
      mockRedisClient.get.mockResolvedValue(null);
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockCompanyRepository.findByCompanyId.mockResolvedValue({
        id: MOCK_COMPANY_ID,
        name: "Test",
        referralCode: MOCK_REFERRAL_CODE,
      } as any);
      mockUserRepository.findByUserId.mockResolvedValue({
        id: MOCK_USER_ID,
        name: "User",
        email: "test@test.com",
      } as any);

      await customService.sendReferralInvite({ email: "test@example.com" });

      expect(mockRedisClient.setex).toHaveBeenCalledWith(expect.any(String), 3600, "1");
    });

    it("should use custom rewardTokens when provided", async () => {
      const customConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: true, rewardTokens: 500 };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ReferralService,
          { provide: REFERRAL_CONFIG, useValue: customConfig },
          { provide: JsonApiService, useValue: mockJsonApiService },
          { provide: ReferralRepository, useValue: mockReferralRepository },
          { provide: CompanyRepository, useValue: mockCompanyRepository },
          { provide: UserRepository, useValue: mockUserRepository },
          { provide: ClsService, useValue: mockClsService },
          { provide: CacheService, useValue: mockCacheService },
          { provide: getQueueToken(QueueId.EMAIL), useValue: mockEmailQueue },
        ],
      }).compile();

      const customService = module.get<ReferralService>(ReferralService);

      // Setup mocks for completeReferralOnPayment
      mockReferralRepository.findPendingByReferredCompanyId.mockResolvedValue({
        id: "referral-123",
        referrer: { id: MOCK_REFERRER_COMPANY_ID },
      } as any);
      mockCompanyRepository.addExtraTokens.mockResolvedValue();
      mockReferralRepository.completeReferral.mockResolvedValue();

      await customService.completeReferralOnPayment({ referredCompanyId: MOCK_COMPANY_ID });

      expect(mockCompanyRepository.addExtraTokens).toHaveBeenCalledWith(expect.objectContaining({ tokens: 500 }));
    });
  });
});
