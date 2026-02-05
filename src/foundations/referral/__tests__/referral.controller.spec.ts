/**
 * ReferralController Unit Tests
 *
 * Tests controller behavior with feature flag,
 * including 404 responses when disabled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";

import { ReferralController } from "../controllers/referral.controller";
import { ReferralService } from "../services/referral.service";
import {
  DEFAULT_REFERRAL_CONFIG,
  REFERRAL_CONFIG,
  ReferralModuleConfig,
} from "../interfaces/referral.config.interface";

// Mock the JwtAuthGuard
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

describe("ReferralController", () => {
  let controller: ReferralController;
  let mockConfig: Required<ReferralModuleConfig>;
  let mockReferralService: vi.Mocked<ReferralService>;
  let mockReply: { send: vi.Mock };

  beforeEach(async () => {
    mockConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: true };

    mockReferralService = {
      getMyCodeJsonApi: vi.fn(),
      sendReferralInvite: vi.fn(),
      getStatsJsonApi: vi.fn(),
      isEnabled: true,
    } as any;

    mockReply = {
      send: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReferralController],
      providers: [
        { provide: ReferralService, useValue: mockReferralService },
        { provide: REFERRAL_CONFIG, useValue: mockConfig },
      ],
    }).compile();

    controller = module.get<ReferralController>(ReferralController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Scenario: Endpoints return 404 when feature disabled", () => {
    beforeEach(async () => {
      mockConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: false };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [ReferralController],
        providers: [
          { provide: ReferralService, useValue: mockReferralService },
          { provide: REFERRAL_CONFIG, useValue: mockConfig },
        ],
      }).compile();

      controller = module.get<ReferralController>(ReferralController);
    });

    it("should throw NotFoundException for GET /referrals/my-code when disabled", async () => {
      await expect(controller.getMyCode(mockReply as any)).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException with correct message for GET /referrals/my-code", async () => {
      await expect(controller.getMyCode(mockReply as any)).rejects.toThrow("Referral feature is not enabled");
    });

    it("should throw NotFoundException for POST /referrals/invite when disabled", async () => {
      await expect(controller.sendInvite(mockReply as any, { email: "test@example.com" })).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException with correct message for POST /referrals/invite", async () => {
      await expect(controller.sendInvite(mockReply as any, { email: "test@example.com" })).rejects.toThrow(
        "Referral feature is not enabled",
      );
    });

    it("should throw NotFoundException for GET /referrals/stats when disabled", async () => {
      await expect(controller.getStats(mockReply as any)).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException with correct message for GET /referrals/stats", async () => {
      await expect(controller.getStats(mockReply as any)).rejects.toThrow("Referral feature is not enabled");
    });

    it("should not call service methods when disabled", async () => {
      await expect(controller.getMyCode(mockReply as any)).rejects.toThrow();
      await expect(controller.sendInvite(mockReply as any, { email: "test@example.com" })).rejects.toThrow();
      await expect(controller.getStats(mockReply as any)).rejects.toThrow();

      expect(mockReferralService.getMyCodeJsonApi).not.toHaveBeenCalled();
      expect(mockReferralService.sendReferralInvite).not.toHaveBeenCalled();
      expect(mockReferralService.getStatsJsonApi).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: Endpoints work normally when feature enabled", () => {
    describe("GET /referrals/my-code", () => {
      it("should return referral code when enabled", async () => {
        const mockResponse = { data: { type: "referral-codes", id: "company-123" } };
        mockReferralService.getMyCodeJsonApi.mockResolvedValue(mockResponse);

        await controller.getMyCode(mockReply as any);

        expect(mockReferralService.getMyCodeJsonApi).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
      });

      it("should not throw when enabled", async () => {
        mockReferralService.getMyCodeJsonApi.mockResolvedValue({ data: {} });

        await expect(controller.getMyCode(mockReply as any)).resolves.not.toThrow();
      });
    });

    describe("POST /referrals/invite", () => {
      it("should send invite when enabled", async () => {
        mockReferralService.sendReferralInvite.mockResolvedValue();

        await controller.sendInvite(mockReply as any, { email: "test@example.com" });

        expect(mockReferralService.sendReferralInvite).toHaveBeenCalledWith({ email: "test@example.com" });
        expect(mockReply.send).toHaveBeenCalled();
      });

      it("should not throw when enabled", async () => {
        mockReferralService.sendReferralInvite.mockResolvedValue();

        await expect(controller.sendInvite(mockReply as any, { email: "test@example.com" })).resolves.not.toThrow();
      });

      it("should pass email from DTO to service", async () => {
        const testEmail = "specific@email.com";
        mockReferralService.sendReferralInvite.mockResolvedValue();

        await controller.sendInvite(mockReply as any, { email: testEmail });

        expect(mockReferralService.sendReferralInvite).toHaveBeenCalledWith({ email: testEmail });
      });
    });

    describe("GET /referrals/stats", () => {
      it("should return stats when enabled", async () => {
        const mockResponse = {
          data: {
            type: "referral-stats",
            id: "company-123",
            attributes: {
              referralCode: "abc123",
              completedReferrals: 5,
              totalTokensEarned: 5000,
            },
          },
        };
        mockReferralService.getStatsJsonApi.mockResolvedValue(mockResponse);

        await controller.getStats(mockReply as any);

        expect(mockReferralService.getStatsJsonApi).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
      });

      it("should not throw when enabled", async () => {
        mockReferralService.getStatsJsonApi.mockResolvedValue({ data: {} });

        await expect(controller.getStats(mockReply as any)).resolves.not.toThrow();
      });
    });
  });

  describe("Scenario: Error handling when enabled", () => {
    it("should propagate service errors for getMyCode", async () => {
      mockReferralService.getMyCodeJsonApi.mockRejectedValue(new Error("Service error"));

      await expect(controller.getMyCode(mockReply as any)).rejects.toThrow("Service error");
    });

    it("should propagate service errors for sendInvite", async () => {
      mockReferralService.sendReferralInvite.mockRejectedValue(new Error("Already invited"));

      await expect(controller.sendInvite(mockReply as any, { email: "test@example.com" })).rejects.toThrow(
        "Already invited",
      );
    });

    it("should propagate service errors for getStats", async () => {
      mockReferralService.getStatsJsonApi.mockRejectedValue(new Error("Company not found"));

      await expect(controller.getStats(mockReply as any)).rejects.toThrow("Company not found");
    });
  });

  describe("Scenario: Feature flag check priority", () => {
    beforeEach(async () => {
      mockConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: false };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [ReferralController],
        providers: [
          { provide: ReferralService, useValue: mockReferralService },
          { provide: REFERRAL_CONFIG, useValue: mockConfig },
        ],
      }).compile();

      controller = module.get<ReferralController>(ReferralController);
    });

    it("should check feature flag before processing getMyCode request", async () => {
      mockReferralService.getMyCodeJsonApi.mockRejectedValue(new Error("Should not be called"));

      // Should throw NotFoundException, not service error
      await expect(controller.getMyCode(mockReply as any)).rejects.toThrow(NotFoundException);
    });

    it("should check feature flag before processing sendInvite request", async () => {
      mockReferralService.sendReferralInvite.mockRejectedValue(new Error("Should not be called"));

      await expect(controller.sendInvite(mockReply as any, { email: "test@example.com" })).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should check feature flag before processing getStats request", async () => {
      mockReferralService.getStatsJsonApi.mockRejectedValue(new Error("Should not be called"));

      await expect(controller.getStats(mockReply as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe("Scenario: Controller with different config values", () => {
    it("should throw 404 when enabled is explicitly false", async () => {
      mockConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: false };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [ReferralController],
        providers: [
          { provide: ReferralService, useValue: mockReferralService },
          { provide: REFERRAL_CONFIG, useValue: mockConfig },
        ],
      }).compile();

      const disabledController = module.get<ReferralController>(ReferralController);

      await expect(disabledController.getMyCode(mockReply as any)).rejects.toThrow(NotFoundException);
    });

    it("should work when enabled is explicitly true", async () => {
      mockConfig = { ...DEFAULT_REFERRAL_CONFIG, enabled: true };
      mockReferralService.getMyCodeJsonApi.mockResolvedValue({ data: {} });

      const module: TestingModule = await Test.createTestingModule({
        controllers: [ReferralController],
        providers: [
          { provide: ReferralService, useValue: mockReferralService },
          { provide: REFERRAL_CONFIG, useValue: mockConfig },
        ],
      }).compile();

      const enabledController = module.get<ReferralController>(ReferralController);

      await expect(enabledController.getMyCode(mockReply as any)).resolves.not.toThrow();
    });
  });

  describe("Scenario: Default config behavior", () => {
    it("should throw 404 when using DEFAULT_REFERRAL_CONFIG (enabled is false)", async () => {
      // DEFAULT_REFERRAL_CONFIG has enabled: false
      const module: TestingModule = await Test.createTestingModule({
        controllers: [ReferralController],
        providers: [
          { provide: ReferralService, useValue: mockReferralService },
          { provide: REFERRAL_CONFIG, useValue: DEFAULT_REFERRAL_CONFIG },
        ],
      }).compile();

      const defaultController = module.get<ReferralController>(ReferralController);

      await expect(defaultController.getMyCode(mockReply as any)).rejects.toThrow(NotFoundException);
      await expect(defaultController.sendInvite(mockReply as any, { email: "test@example.com" })).rejects.toThrow(
        NotFoundException,
      );
      await expect(defaultController.getStats(mockReply as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe("dependency injection", () => {
    it("should have ReferralService injected", () => {
      expect(controller["referralService"]).toBeDefined();
    });

    it("should have config injected", () => {
      expect(controller["config"]).toBeDefined();
    });
  });
});
