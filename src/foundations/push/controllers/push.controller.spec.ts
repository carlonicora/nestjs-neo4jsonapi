import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock push service
vi.mock("../services/push.service", () => ({
  PushService: vi.fn().mockImplementation(() => ({
    registerSubscription: vi.fn(),
  })),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { PushSubscriptionDTO } from "../dtos/subscription.push.dto";
import { PushService } from "../services/push.service";
import { PushController } from "./push.controller";

describe("PushController", () => {
  let controller: PushController;
  let pushService: vi.Mocked<PushService>;

  // Test data
  const mockSubscription: PushSubscriptionDTO = {
    endpoint: "https://push.example.com/abc123",
    keys: {
      p256dh: "p256dh_key_value",
      auth: "auth_key_value",
    },
  } as any;

  beforeEach(async () => {
    const mockPushService = {
      registerSubscription: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushController],
      providers: [{ provide: PushService, useValue: mockPushService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PushController>(PushController);
    pushService = module.get(PushService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("saveSubscription", () => {
    it("should save push subscription", async () => {
      pushService.registerSubscription.mockResolvedValue(undefined);

      await controller.saveSubscription(mockSubscription);

      expect(pushService.registerSubscription).toHaveBeenCalledWith({
        subscription: mockSubscription,
      });
    });

    it("should handle different subscription endpoints", async () => {
      const customSubscription: PushSubscriptionDTO = {
        endpoint: "https://fcm.googleapis.com/fcm/send/xyz",
        keys: {
          p256dh: "different_p256dh",
          auth: "different_auth",
        },
      } as any;
      pushService.registerSubscription.mockResolvedValue(undefined);

      await controller.saveSubscription(customSubscription);

      expect(pushService.registerSubscription).toHaveBeenCalledWith({
        subscription: customSubscription,
      });
    });

    it("should handle service errors", async () => {
      pushService.registerSubscription.mockRejectedValue(new Error("Failed to register subscription"));

      await expect(controller.saveSubscription(mockSubscription)).rejects.toThrow("Failed to register subscription");

      expect(pushService.registerSubscription).toHaveBeenCalled();
    });

    it("should handle duplicate subscription", async () => {
      pushService.registerSubscription.mockRejectedValue(new Error("Subscription already exists"));

      await expect(controller.saveSubscription(mockSubscription)).rejects.toThrow("Subscription already exists");
    });

    it("should handle invalid subscription data", async () => {
      pushService.registerSubscription.mockRejectedValue(new Error("Invalid subscription"));

      const invalidSubscription = {} as PushSubscriptionDTO;
      await expect(controller.saveSubscription(invalidSubscription)).rejects.toThrow("Invalid subscription");
    });
  });

  describe("dependency injection", () => {
    it("should have pushService injected", () => {
      expect(controller["pushService"]).toBeDefined();
    });
  });
});
