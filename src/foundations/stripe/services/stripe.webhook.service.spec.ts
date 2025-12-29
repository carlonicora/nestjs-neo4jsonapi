import { Test, TestingModule } from "@nestjs/testing";
import { StripeWebhookService, WebhookEventData } from "./stripe.webhook.service";
import { StripeService } from "./stripe.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { createMockStripeClient, MockStripeClient } from "../__tests__/mocks/stripe.mock";
import {
  MOCK_WEBHOOK_EVENT,
  MOCK_INVOICE_EVENT,
  MOCK_PAYMENT_EVENT,
  MOCK_CUSTOMER_EVENT,
  MOCK_SUBSCRIPTION,
  MOCK_INVOICE,
  MOCK_PAYMENT_INTENT,
  MOCK_CUSTOMER,
  TEST_IDS,
} from "../__tests__/fixtures/stripe.fixtures";
import Stripe from "stripe";

describe("StripeWebhookService", () => {
  let service: StripeWebhookService;
  let stripeService: jest.Mocked<StripeService>;
  let logger: jest.Mocked<AppLoggingService>;
  let mockStripe: MockStripeClient;

  const mockWebhookSecret = "whsec_test_secret_123";
  const mockPayload = Buffer.from(JSON.stringify({ test: "payload" }));
  const mockSignature = "t=123456789,v1=signature_hash";

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const mockStripeService = {
      getClient: jest.fn().mockReturnValue(mockStripe),
      isConfigured: jest.fn().mockReturnValue(true),
      getWebhookSecret: jest.fn().mockReturnValue(mockWebhookSecret),
    };

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
        {
          provide: AppLoggingService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<StripeWebhookService>(StripeWebhookService);
    stripeService = module.get(StripeService);
    logger = module.get(AppLoggingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructEvent", () => {
    it("should construct event with valid payload and signature", () => {
      mockStripe.webhooks.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);

      const result = service.constructEvent(mockPayload, mockSignature);

      expect(stripeService.getClient).toHaveBeenCalled();
      expect(stripeService.getWebhookSecret).toHaveBeenCalled();
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(mockPayload, mockSignature, mockWebhookSecret);
      expect(result).toEqual(MOCK_WEBHOOK_EVENT);
    });

    it("should throw error when webhook secret is not configured", () => {
      stripeService.getWebhookSecret = jest.fn().mockReturnValue(null);

      expect(() => service.constructEvent(mockPayload, mockSignature)).toThrow("Webhook secret not configured");
    });

    it("should throw error when webhook secret is undefined", () => {
      stripeService.getWebhookSecret = jest.fn().mockReturnValue(undefined as any);

      expect(() => service.constructEvent(mockPayload, mockSignature)).toThrow("Webhook secret not configured");
    });

    it("should throw error when webhook secret is empty string", () => {
      stripeService.getWebhookSecret = jest.fn().mockReturnValue("");

      expect(() => service.constructEvent(mockPayload, mockSignature)).toThrow("Webhook secret not configured");
    });

    it("should handle invalid signature error from Stripe", () => {
      const signatureError = new Error("Invalid signature");
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw signatureError;
      });

      expect(() => service.constructEvent(mockPayload, mockSignature)).toThrow("Invalid signature");
    });

    it("should handle timestamp tolerance error", () => {
      const timestampError = new Error("Timestamp outside the tolerance zone");
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw timestampError;
      });

      expect(() => service.constructEvent(mockPayload, mockSignature)).toThrow("Timestamp outside the tolerance zone");
    });

    it("should construct different event types", () => {
      const eventTypes = [MOCK_WEBHOOK_EVENT, MOCK_INVOICE_EVENT, MOCK_PAYMENT_EVENT, MOCK_CUSTOMER_EVENT];

      eventTypes.forEach((event) => {
        mockStripe.webhooks.constructEvent.mockReturnValue(event);

        const result = service.constructEvent(mockPayload, mockSignature);

        expect(result).toEqual(event);
        expect(result.type).toBe(event.type);
      });
    });

    it("should preserve exact payload and signature values", () => {
      const exactPayload = Buffer.from('{"exact":"data","nested":{"key":"value"}}');
      const exactSignature = "t=1234567890,v1=exact_signature_hash_abc123";
      mockStripe.webhooks.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);

      service.constructEvent(exactPayload, exactSignature);

      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(exactPayload, exactSignature, mockWebhookSecret);
    });
  });

  describe("parseEvent", () => {
    it("should parse webhook event correctly", () => {
      const result = service.parseEvent(MOCK_WEBHOOK_EVENT);

      expect(result).toEqual({
        id: MOCK_WEBHOOK_EVENT.id,
        type: MOCK_WEBHOOK_EVENT.type,
        livemode: MOCK_WEBHOOK_EVENT.livemode,
        created: new Date(MOCK_WEBHOOK_EVENT.created * 1000),
        data: MOCK_WEBHOOK_EVENT.data,
        apiVersion: MOCK_WEBHOOK_EVENT.api_version,
      });
    });

    it("should convert timestamp to Date object", () => {
      const result = service.parseEvent(MOCK_WEBHOOK_EVENT);

      expect(result.created).toBeInstanceOf(Date);
      expect(result.created.getTime()).toBe(MOCK_WEBHOOK_EVENT.created * 1000);
    });

    it("should parse subscription event", () => {
      const result = service.parseEvent(MOCK_WEBHOOK_EVENT);

      expect(result.id).toBe(MOCK_WEBHOOK_EVENT.id);
      expect(result.type).toBe("customer.subscription.created");
      expect(result.data.object).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should parse invoice event", () => {
      const result = service.parseEvent(MOCK_INVOICE_EVENT);

      expect(result.id).toBe(MOCK_INVOICE_EVENT.id);
      expect(result.type).toBe("invoice.payment_succeeded");
      expect(result.data.object).toEqual(MOCK_INVOICE);
    });

    it("should parse payment event", () => {
      const result = service.parseEvent(MOCK_PAYMENT_EVENT);

      expect(result.id).toBe(MOCK_PAYMENT_EVENT.id);
      expect(result.type).toBe("payment_intent.succeeded");
      expect(result.data.object).toEqual(MOCK_PAYMENT_INTENT);
    });

    it("should parse customer event", () => {
      const result = service.parseEvent(MOCK_CUSTOMER_EVENT);

      expect(result.id).toBe(MOCK_CUSTOMER_EVENT.id);
      expect(result.type).toBe("customer.updated");
      expect(result.data.object).toEqual(MOCK_CUSTOMER);
    });

    it("should include api_version in parsed result", () => {
      const result = service.parseEvent(MOCK_WEBHOOK_EVENT);

      expect(result.apiVersion).toBe(MOCK_WEBHOOK_EVENT.api_version);
    });

    it("should handle event with null api_version", () => {
      const eventWithNullVersion = {
        ...MOCK_WEBHOOK_EVENT,
        api_version: null,
      };

      const result = service.parseEvent(eventWithNullVersion);

      expect(result.apiVersion).toBeNull();
    });

    it("should include livemode flag", () => {
      const result = service.parseEvent(MOCK_WEBHOOK_EVENT);

      expect(result.livemode).toBe(false);
    });

    it("should parse livemode event", () => {
      const liveEvent = {
        ...MOCK_WEBHOOK_EVENT,
        livemode: true,
      };

      const result = service.parseEvent(liveEvent);

      expect(result.livemode).toBe(true);
    });

    it("should preserve event data object structure", () => {
      const result = service.parseEvent(MOCK_WEBHOOK_EVENT);

      expect(result.data).toHaveProperty("object");
      expect(result.data.object).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should handle events with previous_attributes", () => {
      const eventWithPrevious: Stripe.Event = {
        ...MOCK_WEBHOOK_EVENT,
        data: {
          object: MOCK_SUBSCRIPTION,
          previous_attributes: {
            status: "trialing",
          },
        },
      };

      const result = service.parseEvent(eventWithPrevious);

      expect(result.data).toHaveProperty("previous_attributes");
      expect(result.data.previous_attributes).toEqual({ status: "trialing" });
    });
  });

  describe("getEventObject", () => {
    it("should extract subscription object from event", () => {
      const result = service.getEventObject<Stripe.Subscription>(MOCK_WEBHOOK_EVENT);

      expect(result).toEqual(MOCK_SUBSCRIPTION);
      expect(result.id).toBe(TEST_IDS.subscriptionId);
    });

    it("should extract invoice object from event", () => {
      const result = service.getEventObject<Stripe.Invoice>(MOCK_INVOICE_EVENT);

      expect(result).toEqual(MOCK_INVOICE);
      expect(result.id).toBe(TEST_IDS.invoiceId);
    });

    it("should extract payment intent object from event", () => {
      const result = service.getEventObject<Stripe.PaymentIntent>(MOCK_PAYMENT_EVENT);

      expect(result).toEqual(MOCK_PAYMENT_INTENT);
      expect(result.id).toBe(TEST_IDS.paymentIntentId);
    });

    it("should extract customer object from event", () => {
      const result = service.getEventObject<Stripe.Customer>(MOCK_CUSTOMER_EVENT);

      expect(result).toEqual(MOCK_CUSTOMER);
      expect(result.id).toBe(TEST_IDS.customerId);
    });

    it("should work with type inference", () => {
      const result = service.getEventObject(MOCK_WEBHOOK_EVENT);

      expect(result).toBeDefined();
      expect(result).toHaveProperty("id");
    });

    it("should preserve all object properties", () => {
      const result = service.getEventObject<Stripe.Subscription>(MOCK_WEBHOOK_EVENT);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("object");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("customer");
      expect(result).toHaveProperty("items");
    });
  });

  describe("isSubscriptionEvent", () => {
    it("should return true for subscription.created event", () => {
      expect(service.isSubscriptionEvent("customer.subscription.created")).toBe(true);
    });

    it("should return true for subscription.updated event", () => {
      expect(service.isSubscriptionEvent("customer.subscription.updated")).toBe(true);
    });

    it("should return true for subscription.deleted event", () => {
      expect(service.isSubscriptionEvent("customer.subscription.deleted")).toBe(true);
    });

    it("should return true for subscription.paused event", () => {
      expect(service.isSubscriptionEvent("customer.subscription.paused")).toBe(true);
    });

    it("should return true for subscription.resumed event", () => {
      expect(service.isSubscriptionEvent("customer.subscription.resumed")).toBe(true);
    });

    it("should return true for subscription.trial_will_end event", () => {
      expect(service.isSubscriptionEvent("customer.subscription.trial_will_end")).toBe(true);
    });

    it("should return false for invoice event", () => {
      expect(service.isSubscriptionEvent("invoice.payment_succeeded")).toBe(false);
    });

    it("should return false for customer event", () => {
      expect(service.isSubscriptionEvent("customer.created")).toBe(false);
    });

    it("should return false for customer.updated event", () => {
      expect(service.isSubscriptionEvent("customer.updated")).toBe(false);
    });

    it("should return false for payment event", () => {
      expect(service.isSubscriptionEvent("payment_intent.succeeded")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(service.isSubscriptionEvent("")).toBe(false);
    });

    it("should handle case sensitivity", () => {
      expect(service.isSubscriptionEvent("customer.subscription.CREATED")).toBe(true);
    });

    it("should handle partial matches correctly", () => {
      expect(service.isSubscriptionEvent("subscription.created")).toBe(false);
    });
  });

  describe("isInvoiceEvent", () => {
    it("should return true for invoice.created event", () => {
      expect(service.isInvoiceEvent("invoice.created")).toBe(true);
    });

    it("should return true for invoice.payment_succeeded event", () => {
      expect(service.isInvoiceEvent("invoice.payment_succeeded")).toBe(true);
    });

    it("should return true for invoice.payment_failed event", () => {
      expect(service.isInvoiceEvent("invoice.payment_failed")).toBe(true);
    });

    it("should return true for invoice.finalized event", () => {
      expect(service.isInvoiceEvent("invoice.finalized")).toBe(true);
    });

    it("should return true for invoice.voided event", () => {
      expect(service.isInvoiceEvent("invoice.voided")).toBe(true);
    });

    it("should return true for invoice.updated event", () => {
      expect(service.isInvoiceEvent("invoice.updated")).toBe(true);
    });

    it("should return false for subscription event", () => {
      expect(service.isInvoiceEvent("customer.subscription.created")).toBe(false);
    });

    it("should return false for customer event", () => {
      expect(service.isInvoiceEvent("customer.created")).toBe(false);
    });

    it("should return false for payment event", () => {
      expect(service.isInvoiceEvent("payment_intent.succeeded")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(service.isInvoiceEvent("")).toBe(false);
    });

    it("should handle case sensitivity", () => {
      expect(service.isInvoiceEvent("invoice.PAYMENT_SUCCEEDED")).toBe(true);
    });
  });

  describe("isPaymentEvent", () => {
    it("should return true for payment_intent.succeeded event", () => {
      expect(service.isPaymentEvent("payment_intent.succeeded")).toBe(true);
    });

    it("should return true for payment_intent.created event", () => {
      expect(service.isPaymentEvent("payment_intent.created")).toBe(true);
    });

    it("should return true for payment_intent.payment_failed event", () => {
      expect(service.isPaymentEvent("payment_intent.payment_failed")).toBe(true);
    });

    it("should return true for payment_method.attached event", () => {
      expect(service.isPaymentEvent("payment_method.attached")).toBe(true);
    });

    it("should return true for payment_method.detached event", () => {
      expect(service.isPaymentEvent("payment_method.detached")).toBe(true);
    });

    it("should return true for payment_method.updated event", () => {
      expect(service.isPaymentEvent("payment_method.updated")).toBe(true);
    });

    it("should return true for charge.succeeded event", () => {
      expect(service.isPaymentEvent("charge.succeeded")).toBe(true);
    });

    it("should return true for charge.failed event", () => {
      expect(service.isPaymentEvent("charge.failed")).toBe(true);
    });

    it("should return true for charge.refunded event", () => {
      expect(service.isPaymentEvent("charge.refunded")).toBe(true);
    });

    it("should return false for subscription event", () => {
      expect(service.isPaymentEvent("customer.subscription.created")).toBe(false);
    });

    it("should return false for invoice event", () => {
      expect(service.isPaymentEvent("invoice.payment_succeeded")).toBe(false);
    });

    it("should return false for customer event", () => {
      expect(service.isPaymentEvent("customer.created")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(service.isPaymentEvent("")).toBe(false);
    });

    it("should be case-sensitive", () => {
      // startsWith() is case-sensitive, so these should return false
      expect(service.isPaymentEvent("payment_intent.SUCCEEDED")).toBe(true);
      expect(service.isPaymentEvent("PAYMENT_METHOD.attached")).toBe(false);
      expect(service.isPaymentEvent("CHARGE.succeeded")).toBe(false);
    });
  });

  describe("isCustomerEvent", () => {
    it("should return true for customer.created event", () => {
      expect(service.isCustomerEvent("customer.created")).toBe(true);
    });

    it("should return true for customer.updated event", () => {
      expect(service.isCustomerEvent("customer.updated")).toBe(true);
    });

    it("should return true for customer.deleted event", () => {
      expect(service.isCustomerEvent("customer.deleted")).toBe(true);
    });

    it("should return false for subscription event", () => {
      expect(service.isCustomerEvent("customer.subscription.created")).toBe(false);
    });

    it("should return false for subscription.updated event", () => {
      expect(service.isCustomerEvent("customer.subscription.updated")).toBe(false);
    });

    it("should return false for subscription.deleted event", () => {
      expect(service.isCustomerEvent("customer.subscription.deleted")).toBe(false);
    });

    it("should return false for invoice event", () => {
      expect(service.isCustomerEvent("invoice.payment_succeeded")).toBe(false);
    });

    it("should return false for payment event", () => {
      expect(service.isCustomerEvent("payment_intent.succeeded")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(service.isCustomerEvent("")).toBe(false);
    });

    it("should handle case sensitivity", () => {
      expect(service.isCustomerEvent("customer.CREATED")).toBe(true);
    });

    it("should correctly exclude subscription events", () => {
      const subscriptionEvents = [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
      ];

      subscriptionEvents.forEach((event) => {
        expect(service.isCustomerEvent(event)).toBe(false);
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle malformed event types gracefully", () => {
      expect(service.isSubscriptionEvent("customer.")).toBe(false);
      // "invoice." DOES match startsWith("invoice."), so it returns true
      expect(service.isInvoiceEvent("invoice.")).toBe(true);
      expect(service.isPaymentEvent("payment_")).toBe(false);
      expect(service.isCustomerEvent("customer.")).toBe(true);
    });

    it("should handle events with extra dots", () => {
      expect(service.isSubscriptionEvent("customer.subscription.created.extra")).toBe(true);
      expect(service.isInvoiceEvent("invoice.payment.succeeded.extra")).toBe(true);
    });

    it("should parse events with very old timestamps", () => {
      const oldEvent = {
        ...MOCK_WEBHOOK_EVENT,
        created: 0,
      };

      const result = service.parseEvent(oldEvent);

      expect(result.created).toEqual(new Date(0));
    });

    it("should parse events with future timestamps", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const futureEvent = {
        ...MOCK_WEBHOOK_EVENT,
        created: futureTimestamp,
      };

      const result = service.parseEvent(futureEvent);

      expect(result.created).toEqual(new Date(futureTimestamp * 1000));
    });

    it("should handle event construction with empty payload", () => {
      const emptyPayload = Buffer.from("");
      const error = new Error("Invalid payload");
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw error;
      });

      expect(() => service.constructEvent(emptyPayload, mockSignature)).toThrow("Invalid payload");
    });

    it("should handle event construction with very large payload", () => {
      const largeData = { data: "x".repeat(100000) };
      const largePayload = Buffer.from(JSON.stringify(largeData));
      mockStripe.webhooks.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);

      const result = service.constructEvent(largePayload, mockSignature);

      expect(result).toEqual(MOCK_WEBHOOK_EVENT);
    });
  });

  describe("Service Integration", () => {
    it("should use StripeService to get client for event construction", () => {
      mockStripe.webhooks.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);

      service.constructEvent(mockPayload, mockSignature);

      expect(stripeService.getClient).toHaveBeenCalledTimes(1);
    });

    it("should use StripeService to get webhook secret", () => {
      mockStripe.webhooks.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);

      service.constructEvent(mockPayload, mockSignature);

      expect(stripeService.getWebhookSecret).toHaveBeenCalledTimes(1);
    });

    it("should call services in correct order", () => {
      const callOrder: string[] = [];
      stripeService.getClient = jest.fn(() => {
        callOrder.push("getClient");
        return mockStripe;
      });
      stripeService.getWebhookSecret = jest.fn(() => {
        callOrder.push("getWebhookSecret");
        return mockWebhookSecret;
      });
      mockStripe.webhooks.constructEvent.mockImplementation((...args) => {
        callOrder.push("constructEvent");
        return MOCK_WEBHOOK_EVENT;
      });

      service.constructEvent(mockPayload, mockSignature);

      expect(callOrder).toEqual(["getClient", "getWebhookSecret", "constructEvent"]);
    });
  });

  describe("Type Safety", () => {
    it("should correctly type subscription objects", () => {
      const subscription = service.getEventObject<Stripe.Subscription>(MOCK_WEBHOOK_EVENT);

      expect(subscription).toHaveProperty("items");
      expect(subscription).toHaveProperty("status");
      expect(subscription.object).toBe("subscription");
    });

    it("should correctly type invoice objects", () => {
      const invoice = service.getEventObject<Stripe.Invoice>(MOCK_INVOICE_EVENT);

      expect(invoice).toHaveProperty("amount_due");
      expect(invoice).toHaveProperty("lines");
      expect(invoice.object).toBe("invoice");
    });

    it("should correctly type payment intent objects", () => {
      const paymentIntent = service.getEventObject<Stripe.PaymentIntent>(MOCK_PAYMENT_EVENT);

      expect(paymentIntent).toHaveProperty("amount");
      expect(paymentIntent).toHaveProperty("status");
      expect(paymentIntent.object).toBe("payment_intent");
    });

    it("should correctly type customer objects", () => {
      const customer = service.getEventObject<Stripe.Customer>(MOCK_CUSTOMER_EVENT);

      expect(customer).toHaveProperty("email");
      expect(customer).toHaveProperty("metadata");
      expect(customer.object).toBe("customer");
    });
  });

  describe("Webhook Event Processing Flow", () => {
    it("should support complete webhook processing flow", () => {
      mockStripe.webhooks.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);

      const event = service.constructEvent(mockPayload, mockSignature);
      const parsedEvent = service.parseEvent(event);
      const subscription = service.getEventObject<Stripe.Subscription>(event);
      const isSubscription = service.isSubscriptionEvent(event.type);

      expect(event).toEqual(MOCK_WEBHOOK_EVENT);
      expect(parsedEvent.type).toBe("customer.subscription.created");
      expect(subscription).toEqual(MOCK_SUBSCRIPTION);
      expect(isSubscription).toBe(true);
    });

    it("should categorize events correctly in processing flow", () => {
      const events = [
        { event: MOCK_WEBHOOK_EVENT, isSubscription: true, isInvoice: false, isPayment: false, isCustomer: false },
        { event: MOCK_INVOICE_EVENT, isSubscription: false, isInvoice: true, isPayment: false, isCustomer: false },
        { event: MOCK_PAYMENT_EVENT, isSubscription: false, isInvoice: false, isPayment: true, isCustomer: false },
        { event: MOCK_CUSTOMER_EVENT, isSubscription: false, isInvoice: false, isPayment: false, isCustomer: true },
      ];

      events.forEach(({ event, isSubscription, isInvoice, isPayment, isCustomer }) => {
        expect(service.isSubscriptionEvent(event.type)).toBe(isSubscription);
        expect(service.isInvoiceEvent(event.type)).toBe(isInvoice);
        expect(service.isPaymentEvent(event.type)).toBe(isPayment);
        expect(service.isCustomerEvent(event.type)).toBe(isCustomer);
      });
    });
  });
});
