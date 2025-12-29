import { Test, TestingModule } from "@nestjs/testing";
import { StripeService } from "./stripe.service";

// Mock the base config before imports
jest.mock("../../../config/base.config", () => ({
  baseConfig: {
    stripe: {
      secretKey: "sk_test_mock_secret_key",
      publishableKey: "pk_test_mock_publishable_key",
      webhookSecret: "whsec_test_mock_webhook_secret",
      apiVersion: "2024-11-20.acacia",
      portalReturnUrl: "https://example.com/portal/return",
      portalConfigurationId: "bpc_test_123",
    },
  },
}));

// Mock Stripe SDK
const mockStripeConstructor = jest.fn();
jest.mock("stripe", () => ({
  default: mockStripeConstructor,
}));

describe("StripeService", () => {
  let service: StripeService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [StripeService],
    }).compile();

    service = module.get<StripeService>(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("isConfigured", () => {
    it("should return false before initialization", () => {
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe("getPublishableKey", () => {
    it("should return publishable key from config", () => {
      const key = service.getPublishableKey();

      expect(key).toBe("pk_test_mock_publishable_key");
    });

    it("should return exact value provided in config", () => {
      const key = service.getPublishableKey();

      expect(key).toBe("pk_test_mock_publishable_key");
      expect(key).not.toBe("pk_test_different_key");
    });
  });

  describe("getWebhookSecret", () => {
    it("should return webhook secret from config", () => {
      const secret = service.getWebhookSecret();

      expect(secret).toBe("whsec_test_mock_webhook_secret");
    });

    it("should return exact value provided in config", () => {
      const secret = service.getWebhookSecret();

      expect(secret).toBe("whsec_test_mock_webhook_secret");
      expect(secret).not.toBe("whsec_different_secret");
    });
  });

  describe("getPortalReturnUrl", () => {
    it("should return portal return URL from config", () => {
      const url = service.getPortalReturnUrl();

      expect(url).toBe("https://example.com/portal/return");
    });

    it("should return exact value provided in config", () => {
      const url = service.getPortalReturnUrl();

      expect(url).toBe("https://example.com/portal/return");
      expect(url).not.toBe("https://different.com/return");
    });
  });

  describe("getPortalConfigurationId", () => {
    it("should return portal configuration ID when configured", () => {
      const configId = service.getPortalConfigurationId();

      expect(configId).toBe("bpc_test_123");
    });

    it("should return exact value provided in config", () => {
      const configId = service.getPortalConfigurationId();

      expect(configId).toBe("bpc_test_123");
      expect(configId).not.toBe("bpc_different_123");
    });
  });

  describe("Integration", () => {
    it("should be injectable in NestJS modules", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [StripeService],
      }).compile();

      const injectedService = module.get<StripeService>(StripeService);

      expect(injectedService).toBeDefined();
      expect(injectedService).toBeInstanceOf(StripeService);
    });

    it("should implement OnModuleInit interface", async () => {
      expect(service.onModuleInit).toBeDefined();
      expect(typeof service.onModuleInit).toBe("function");
    });

    it("should provide consistent configuration across method calls", () => {
      const publishableKey1 = service.getPublishableKey();
      const publishableKey2 = service.getPublishableKey();
      const webhookSecret1 = service.getWebhookSecret();
      const webhookSecret2 = service.getWebhookSecret();

      expect(publishableKey1).toBe(publishableKey2);
      expect(webhookSecret1).toBe(webhookSecret2);
    });
  });
});
