import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";

// Mock web-push - must be before imports and use factory that doesn't reference external variables
vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PushService } from "../push.service";
import { PushRepository } from "../../repositories/push.repository";
import { Push } from "../../entities/push.entity";
import * as webPush from "web-push";

describe("PushService", () => {
  let service: PushService;
  let pushRepository: MockedObject<PushRepository>;
  let configService: MockedObject<ConfigService>;

  const MOCK_VAPID_CONFIG = {
    publicKey: "test-public-key",
    privateKey: "test-private-key",
    email: "test@example.com",
  };

  const MOCK_SUBSCRIPTION = {
    endpoint: "https://push.example.com/subscription/123",
    keys: {
      p256dh: "test-p256dh-key",
      auth: "test-auth-key",
    },
  };

  const MOCK_PUSH_ENTITY: Push = {
    id: "push-123",
    endpoint: "https://push.example.com/subscription/123",
    p256dh: "test-p256dh-key",
    auth: "test-auth-key",
    subscription: {
      endpoint: "https://push.example.com/subscription/123",
      keys: {
        p256dh: "test-p256dh-key",
        auth: "test-auth-key",
      },
    },
  } as Push;

  const createMockPushRepository = () => ({
    create: vi.fn(),
    findByEndpoint: vi.fn(),
    findByUserId: vi.fn(),
    deleteByEndpoint: vi.fn(),
  });

  const createMockConfigService = (vapidConfig: any = MOCK_VAPID_CONFIG) => ({
    get: vi.fn().mockImplementation((key: string) => {
      if (key === "vapid") return vapidConfig;
      return undefined;
    }),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset web-push mock
    vi.mocked(webPush).setVapidDetails.mockClear();
    vi.mocked(webPush).sendNotification.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PushRepository, useValue: createMockPushRepository() },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get<PushService>(PushService);
    pushRepository = module.get(PushRepository) as MockedObject<PushRepository>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });

    it("should set VAPID details when config is valid", async () => {
      // The constructor should have called setVapidDetails
      expect(vi.mocked(webPush).setVapidDetails).toHaveBeenCalledWith(
        `mailto:${MOCK_VAPID_CONFIG.email}`,
        MOCK_VAPID_CONFIG.publicKey,
        MOCK_VAPID_CONFIG.privateKey,
      );
    });

    it("should not set VAPID details when public key is missing", async () => {
      vi.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PushService,
          { provide: PushRepository, useValue: createMockPushRepository() },
          { provide: ConfigService, useValue: createMockConfigService({ privateKey: "key", email: "test@test.com" }) },
        ],
      }).compile();

      const inactiveService = module.get<PushService>(PushService);
      expect(inactiveService).toBeDefined();
      // setVapidDetails should not be called
      expect(vi.mocked(webPush).setVapidDetails).not.toHaveBeenCalled();
    });

    it("should not set VAPID details when private key is missing", async () => {
      vi.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PushService,
          { provide: PushRepository, useValue: createMockPushRepository() },
          { provide: ConfigService, useValue: createMockConfigService({ publicKey: "key", email: "test@test.com" }) },
        ],
      }).compile();

      const inactiveService = module.get<PushService>(PushService);
      expect(inactiveService).toBeDefined();
      expect(vi.mocked(webPush).setVapidDetails).not.toHaveBeenCalled();
    });
  });

  describe("registerSubscription", () => {
    it("should create subscription when it does not exist", async () => {
      // Arrange
      pushRepository.findByEndpoint.mockResolvedValue([]);
      pushRepository.create.mockResolvedValue(undefined);

      // Act
      await service.registerSubscription({ subscription: MOCK_SUBSCRIPTION });

      // Assert
      expect(pushRepository.findByEndpoint).toHaveBeenCalledWith({ endpoint: MOCK_SUBSCRIPTION.endpoint });
      expect(pushRepository.create).toHaveBeenCalledWith({
        endpoint: MOCK_SUBSCRIPTION.endpoint,
        p256dh: MOCK_SUBSCRIPTION.keys.p256dh,
        auth: MOCK_SUBSCRIPTION.keys.auth,
      });
    });

    it("should not create subscription when it already exists", async () => {
      // Arrange
      pushRepository.findByEndpoint.mockResolvedValue([MOCK_PUSH_ENTITY]);

      // Act
      await service.registerSubscription({ subscription: MOCK_SUBSCRIPTION });

      // Assert
      expect(pushRepository.findByEndpoint).toHaveBeenCalledWith({ endpoint: MOCK_SUBSCRIPTION.endpoint });
      expect(pushRepository.create).not.toHaveBeenCalled();
    });

    it("should not register when service is inactive", async () => {
      // Arrange - create inactive service
      vi.clearAllMocks();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PushService,
          { provide: PushRepository, useValue: createMockPushRepository() },
          { provide: ConfigService, useValue: createMockConfigService(null) },
        ],
      }).compile();

      const inactiveService = module.get<PushService>(PushService);
      const inactiveRepo = module.get(PushRepository) as MockedObject<PushRepository>;

      // Act
      await inactiveService.registerSubscription({ subscription: MOCK_SUBSCRIPTION });

      // Assert
      expect(inactiveRepo.findByEndpoint).not.toHaveBeenCalled();
      expect(inactiveRepo.create).not.toHaveBeenCalled();
    });

    it("should create subscription when findByEndpoint returns null", async () => {
      // Arrange
      pushRepository.findByEndpoint.mockResolvedValue(null);
      pushRepository.create.mockResolvedValue(undefined);

      // Act
      await service.registerSubscription({ subscription: MOCK_SUBSCRIPTION });

      // Assert
      expect(pushRepository.create).toHaveBeenCalled();
    });
  });

  describe("sendNotification", () => {
    const notificationParams = {
      pushSubscriptions: [MOCK_PUSH_ENTITY],
      title: "Test Title",
      message: "Test Message",
      url: "https://example.com/notification",
    };

    it("should send notification to all subscriptions", async () => {
      // Arrange
      vi.mocked(webPush).sendNotification.mockResolvedValue({});

      // Act
      await service.sendNotification(notificationParams);

      // Assert
      expect(vi.mocked(webPush).sendNotification).toHaveBeenCalledWith(
        MOCK_PUSH_ENTITY.subscription,
        JSON.stringify({
          title: notificationParams.title,
          message: notificationParams.message,
          url: notificationParams.url,
        }),
      );
    });

    it("should send to multiple subscriptions", async () => {
      // Arrange
      const secondPush: Push = {
        ...MOCK_PUSH_ENTITY,
        id: "push-456",
        endpoint: "https://push.example.com/subscription/456",
      };
      vi.mocked(webPush).sendNotification.mockResolvedValue({});

      // Act
      await service.sendNotification({
        ...notificationParams,
        pushSubscriptions: [MOCK_PUSH_ENTITY, secondPush],
      });

      // Assert
      expect(vi.mocked(webPush).sendNotification).toHaveBeenCalledTimes(2);
    });

    it("should catch and log errors without throwing", async () => {
      // Arrange
      vi.mocked(webPush).sendNotification.mockRejectedValue(new Error("Push failed"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Act & Assert - should not throw
      await expect(service.sendNotification(notificationParams)).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith("Error sending push notification", expect.any(Error));
      expect(pushRepository.deleteByEndpoint).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it.each([410, 404])("should prune the subscription (no error log) on a %i status code", async (statusCode) => {
      // Arrange - 404/410 mean the subscription is permanently gone
      vi.mocked(webPush).sendNotification.mockRejectedValue(
        Object.assign(new Error("Gone"), { statusCode, endpoint: MOCK_PUSH_ENTITY.subscription.endpoint }),
      );
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Act & Assert - should not throw, should delete, should NOT log
      await expect(service.sendNotification(notificationParams)).resolves.toBeUndefined();
      expect(pushRepository.deleteByEndpoint).toHaveBeenCalledWith({
        endpoint: MOCK_PUSH_ENTITY.subscription.endpoint,
      });
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should not send notifications when service is inactive", async () => {
      // Arrange - create inactive service
      vi.clearAllMocks();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PushService,
          { provide: PushRepository, useValue: createMockPushRepository() },
          { provide: ConfigService, useValue: createMockConfigService(null) },
        ],
      }).compile();

      const inactiveService = module.get<PushService>(PushService);

      // Act
      await inactiveService.sendNotification(notificationParams);

      // Assert
      expect(vi.mocked(webPush).sendNotification).not.toHaveBeenCalled();
    });

    it("should handle empty subscriptions array", async () => {
      // Act
      await service.sendNotification({
        ...notificationParams,
        pushSubscriptions: [],
      });

      // Assert
      expect(vi.mocked(webPush).sendNotification).not.toHaveBeenCalled();
    });

    it("should continue sending to other subscriptions when one fails", async () => {
      // Arrange
      const secondPush: Push = {
        ...MOCK_PUSH_ENTITY,
        id: "push-456",
        endpoint: "https://push.example.com/subscription/456",
      };
      vi.mocked(webPush).sendNotification.mockRejectedValueOnce(new Error("First failed")).mockResolvedValueOnce({});
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Act
      await service.sendNotification({
        ...notificationParams,
        pushSubscriptions: [MOCK_PUSH_ENTITY, secondPush],
      });

      // Assert
      expect(vi.mocked(webPush).sendNotification).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });
  });
});
