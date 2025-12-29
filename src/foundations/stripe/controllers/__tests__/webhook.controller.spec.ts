// Set environment variables before any imports
process.env.QUEUE = "test";

// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide only what we need
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = jest.requireActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
    // Override companyMeta that billing-customer.model needs
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { Queue } from "bullmq";
import Stripe from "stripe";
import { WebhookController } from "../webhook.controller";
import { StripeWebhookService, AppLoggingService } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookEventRepository } from "../../repositories/webhook-event.repository";
import { WebhookJobData } from "../../processors/webhook.processor";
import type { WebhookEvent } from "../../entities/webhook-event.entity";

describe("WebhookController", () => {
  let controller: WebhookController;
  let stripeWebhookService: jest.Mocked<StripeWebhookService>;
  let webhookEventRepository: jest.Mocked<WebhookEventRepository>;
  let logger: jest.Mocked<AppLoggingService>;
  let webhookQueue: jest.Mocked<Queue<WebhookJobData>>;
  let mockReply: jest.Mocked<FastifyReply>;

  // Test data constants
  const TEST_DATA = {
    signature: "t=1234567890,v1=test_signature_hash",
    rawBody: Buffer.from(JSON.stringify({ type: "customer.subscription.created" })),
    stripeEventId: "evt_test_123456789",
    eventType: "customer.subscription.created",
    webhookEventId: "webhook_evt_uuid_123",
  };

  // Mock Stripe event
  const createMockStripeEvent = (overrides?: Partial<Stripe.Event>): Stripe.Event => {
    return {
      id: TEST_DATA.stripeEventId,
      object: "event",
      api_version: "2024-12-18.acacia",
      created: 1234567890,
      type: TEST_DATA.eventType,
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: null,
        idempotency_key: null,
      },
      data: {
        object: {
          id: "sub_123",
          object: "subscription",
          status: "active",
          customer: "cus_123",
        } as Stripe.Subscription,
      },
      ...overrides,
    } as Stripe.Event;
  };

  // Mock webhook event entity
  const createMockWebhookEvent = (overrides?: Partial<WebhookEvent>): WebhookEvent => {
    return {
      id: TEST_DATA.webhookEventId,
      stripeEventId: TEST_DATA.stripeEventId,
      eventType: TEST_DATA.eventType,
      livemode: false,
      apiVersion: "2024-12-18.acacia",
      status: "pending",
      payload: {
        id: "sub_123",
        object: "subscription",
        status: "active",
        customer: "cus_123",
      },
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as WebhookEvent;
  };

  // Create a mock Fastify request with rawBody
  const createMockRequest = (rawBody?: Buffer): jest.Mocked<FastifyRequest> => {
    return {
      rawBody: rawBody || TEST_DATA.rawBody,
      headers: {},
      body: {},
    } as unknown as jest.Mocked<FastifyRequest>;
  };

  // Create a mock Fastify reply
  const createMockReply = (): jest.Mocked<FastifyReply> => {
    const reply = {
      send: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      code: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    // Mock StripeWebhookService
    const mockStripeWebhookService = {
      constructEvent: jest.fn(),
      parseEvent: jest.fn(),
      getEventObject: jest.fn(),
      isSubscriptionEvent: jest.fn(),
      isInvoiceEvent: jest.fn(),
      isPaymentEvent: jest.fn(),
      isCustomerEvent: jest.fn(),
    };

    // Mock WebhookEventRepository
    const mockWebhookEventRepository = {
      findByStripeEventId: jest.fn(),
      findPendingEvents: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
    };

    // Mock AppLoggingService
    const mockLogger = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      verbose: jest.fn(),
    };

    // Mock BullMQ Queue
    const mockQueue = {
      add: jest.fn(),
      close: jest.fn(),
      getJob: jest.fn(),
      getJobs: jest.fn(),
    } as unknown as jest.Mocked<Queue<WebhookJobData>>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        {
          provide: StripeWebhookService,
          useValue: mockStripeWebhookService,
        },
        {
          provide: WebhookEventRepository,
          useValue: mockWebhookEventRepository,
        },
        {
          provide: AppLoggingService,
          useValue: mockLogger,
        },
        {
          provide: `BullQueue_${process.env.QUEUE}_billing_webhook`,
          useValue: mockQueue,
        },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
    stripeWebhookService = module.get(StripeWebhookService);
    webhookEventRepository = module.get(WebhookEventRepository);
    logger = module.get(AppLoggingService);
    webhookQueue = module.get(`BullQueue_${process.env.QUEUE}_billing_webhook`);

    mockReply = createMockReply();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // HAPPY PATH - SUCCESSFUL WEBHOOK PROCESSING
  // ===================================================================

  describe("POST /billing/webhooks/stripe - Happy Path", () => {
    it("should successfully process a valid webhook event", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      // Setup mocks
      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      // Verify signature validation
      expect(stripeWebhookService.constructEvent).toHaveBeenCalledWith(TEST_DATA.rawBody, TEST_DATA.signature);

      // Verify event parsing
      expect(stripeWebhookService.parseEvent).toHaveBeenCalledWith(mockStripeEvent);

      // Verify duplicate check
      expect(webhookEventRepository.findByStripeEventId).toHaveBeenCalledWith({
        stripeEventId: mockStripeEvent.id,
      });

      // Verify webhook event creation
      expect(webhookEventRepository.create).toHaveBeenCalledWith({
        stripeEventId: mockStripeEvent.id,
        eventType: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        apiVersion: mockStripeEvent.api_version,
        payload: mockStripeEvent.data.object,
      });

      // Verify queue job creation with correct structure
      expect(webhookQueue.add).toHaveBeenCalledWith(
        mockStripeEvent.type,
        {
          webhookEventId: mockWebhookEvent.id,
          stripeEventId: mockStripeEvent.id,
          eventType: mockStripeEvent.type,
          payload: mockStripeEvent.data.object,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      // Verify logging
      expect(logger.debug).toHaveBeenCalledWith(
        `Webhook event queued: ${mockStripeEvent.type} (${mockStripeEvent.id})`,
      );

      // Verify response
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockReply.send).toHaveBeenCalledWith({ received: true });
    });

    it("should process webhook with different event types", async () => {
      const eventTypes = [
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.paid",
        "invoice.payment_failed",
        "customer.updated",
        "payment_intent.succeeded",
      ];

      for (const eventType of eventTypes) {
        jest.clearAllMocks();

        const req = createMockRequest();
        const mockStripeEvent = createMockStripeEvent({ type: eventType });
        const mockWebhookEvent = createMockWebhookEvent({ eventType });

        stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
        stripeWebhookService.parseEvent.mockReturnValue({
          id: mockStripeEvent.id,
          type: eventType,
          livemode: mockStripeEvent.livemode,
          created: new Date(mockStripeEvent.created * 1000),
          data: mockStripeEvent.data,
          apiVersion: mockStripeEvent.api_version,
        });
        webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
        webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
        webhookQueue.add.mockResolvedValue({} as any);

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(webhookQueue.add).toHaveBeenCalledWith(
          eventType,
          expect.objectContaining({
            eventType,
          }),
          expect.any(Object),
        );

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(mockReply.send).toHaveBeenCalledWith({ received: true });
      }
    });

    it("should handle livemode events correctly", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent({ livemode: true });
      const mockWebhookEvent = createMockWebhookEvent({ livemode: true });

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: true,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(webhookEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          livemode: true,
        }),
      );

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
    });

    it("should handle events with null api_version", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent({ api_version: null });
      const mockWebhookEvent = createMockWebhookEvent({ apiVersion: null });

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: null,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(webhookEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apiVersion: null,
        }),
      );

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
    });
  });

  // ===================================================================
  // IDEMPOTENCY - DUPLICATE EVENT DETECTION
  // ===================================================================

  describe("POST /billing/webhooks/stripe - Idempotency", () => {
    it("should detect and handle duplicate events", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const existingWebhookEvent = createMockWebhookEvent({
        status: "completed",
        processedAt: new Date(),
      });

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(existingWebhookEvent);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      // Verify duplicate event was found
      expect(webhookEventRepository.findByStripeEventId).toHaveBeenCalledWith({
        stripeEventId: mockStripeEvent.id,
      });

      // Verify no new event was created
      expect(webhookEventRepository.create).not.toHaveBeenCalled();

      // Verify no job was queued
      expect(webhookQueue.add).not.toHaveBeenCalled();

      // Verify debug logging
      expect(logger.debug).toHaveBeenCalledWith(`Duplicate webhook event received: ${mockStripeEvent.id}`);

      // Verify response indicates duplicate
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockReply.send).toHaveBeenCalledWith({ received: true, duplicate: true });
    });

    it("should handle duplicate events with different statuses", async () => {
      const statuses = ["pending", "processing", "completed", "failed"] as const;

      for (const status of statuses) {
        jest.clearAllMocks();

        const req = createMockRequest();
        const mockStripeEvent = createMockStripeEvent();
        const existingWebhookEvent = createMockWebhookEvent({ status });

        stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
        stripeWebhookService.parseEvent.mockReturnValue({
          id: mockStripeEvent.id,
          type: mockStripeEvent.type,
          livemode: mockStripeEvent.livemode,
          created: new Date(mockStripeEvent.created * 1000),
          data: mockStripeEvent.data,
          apiVersion: mockStripeEvent.api_version,
        });
        webhookEventRepository.findByStripeEventId.mockResolvedValue(existingWebhookEvent);

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(webhookEventRepository.create).not.toHaveBeenCalled();
        expect(webhookQueue.add).not.toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith({ received: true, duplicate: true });
      }
    });
  });

  // ===================================================================
  // ERROR SCENARIOS
  // ===================================================================

  describe("POST /billing/webhooks/stripe - Error Scenarios", () => {
    describe("Missing signature header", () => {
      it("should return 400 BAD_REQUEST when signature header is missing", async () => {
        const req = createMockRequest();

        await controller.handleStripeWebhook(req, mockReply, undefined as any);

        expect(logger.warn).toHaveBeenCalledWith("Webhook received without signature");
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Missing stripe-signature header" });
        expect(stripeWebhookService.constructEvent).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when signature is empty string", async () => {
        const req = createMockRequest();

        await controller.handleStripeWebhook(req, mockReply, "");

        expect(logger.warn).toHaveBeenCalledWith("Webhook received without signature");
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Missing stripe-signature header" });
        expect(stripeWebhookService.constructEvent).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when signature is null", async () => {
        const req = createMockRequest();

        await controller.handleStripeWebhook(req, mockReply, null as any);

        expect(logger.warn).toHaveBeenCalledWith("Webhook received without signature");
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Missing stripe-signature header" });
      });
    });

    describe("Missing rawBody", () => {
      it("should return 400 BAD_REQUEST when rawBody is not available", async () => {
        const req = {
          headers: {},
          body: {},
          // rawBody is not set
        } as unknown as jest.Mocked<FastifyRequest>;

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(logger.error).toHaveBeenCalledWith("Raw body not available for webhook verification");
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Raw body not available" });
        expect(stripeWebhookService.constructEvent).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when rawBody is null", async () => {
        const req = {
          rawBody: null,
        } as unknown as jest.Mocked<FastifyRequest>;

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(logger.error).toHaveBeenCalledWith("Raw body not available for webhook verification");
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Raw body not available" });
      });
    });

    describe("Signature verification failed", () => {
      it("should return 400 BAD_REQUEST when signature verification fails", async () => {
        const req = createMockRequest();
        const signatureError = new Error("No signatures found matching the expected signature for payload");

        stripeWebhookService.constructEvent.mockImplementation(() => {
          throw signatureError;
        });

        await controller.handleStripeWebhook(req, mockReply, "invalid_signature");

        expect(logger.warn).toHaveBeenCalledWith(`Webhook signature verification failed: ${signatureError.message}`);
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Webhook signature verification failed" });
        expect(webhookEventRepository.findByStripeEventId).not.toHaveBeenCalled();
      });

      it("should detect signature errors with different error messages", async () => {
        const signatureErrorMessages = [
          "Invalid signature",
          "Webhook signature verification failed",
          "The signature header is invalid",
          "No signatures found matching the expected signature for payload",
        ];

        for (const errorMessage of signatureErrorMessages) {
          jest.clearAllMocks();

          const req = createMockRequest();
          const signatureError = new Error(errorMessage);

          stripeWebhookService.constructEvent.mockImplementation(() => {
            throw signatureError;
          });

          await controller.handleStripeWebhook(req, mockReply, "bad_signature");

          expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
          expect(mockReply.send).toHaveBeenCalledWith({ error: "Webhook signature verification failed" });
        }
      });

      it("should handle Stripe webhook signature errors specifically", async () => {
        const req = createMockRequest();
        const error = new Error("Webhook signature verification failed: timestamp tolerance");

        stripeWebhookService.constructEvent.mockImplementation(() => {
          throw error;
        });

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(logger.warn).toHaveBeenCalledWith(`Webhook signature verification failed: ${error.message}`);
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Webhook signature verification failed" });
      });
    });

    describe("Other internal errors", () => {
      it("should return 500 INTERNAL_SERVER_ERROR for unexpected errors", async () => {
        const req = createMockRequest();
        const mockStripeEvent = createMockStripeEvent();
        const internalError = new Error("Database connection failed");

        stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
        stripeWebhookService.parseEvent.mockReturnValue({
          id: mockStripeEvent.id,
          type: mockStripeEvent.type,
          livemode: mockStripeEvent.livemode,
          created: new Date(mockStripeEvent.created * 1000),
          data: mockStripeEvent.data,
          apiVersion: mockStripeEvent.api_version,
        });
        webhookEventRepository.findByStripeEventId.mockRejectedValue(internalError);

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(logger.error).toHaveBeenCalledWith(`Webhook processing error: ${internalError.message}`);
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Internal server error" });
      });

      it("should return 500 for repository errors during create", async () => {
        const req = createMockRequest();
        const mockStripeEvent = createMockStripeEvent();
        const repositoryError = new Error("Failed to create webhook event");

        stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
        stripeWebhookService.parseEvent.mockReturnValue({
          id: mockStripeEvent.id,
          type: mockStripeEvent.type,
          livemode: mockStripeEvent.livemode,
          created: new Date(mockStripeEvent.created * 1000),
          data: mockStripeEvent.data,
          apiVersion: mockStripeEvent.api_version,
        });
        webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
        webhookEventRepository.create.mockRejectedValue(repositoryError);

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(logger.error).toHaveBeenCalledWith(`Webhook processing error: ${repositoryError.message}`);
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Internal server error" });
      });

      it("should return 500 for queue errors", async () => {
        const req = createMockRequest();
        const mockStripeEvent = createMockStripeEvent();
        const mockWebhookEvent = createMockWebhookEvent();
        const queueError = new Error("Redis connection failed");

        stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
        stripeWebhookService.parseEvent.mockReturnValue({
          id: mockStripeEvent.id,
          type: mockStripeEvent.type,
          livemode: mockStripeEvent.livemode,
          created: new Date(mockStripeEvent.created * 1000),
          data: mockStripeEvent.data,
          apiVersion: mockStripeEvent.api_version,
        });
        webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
        webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
        webhookQueue.add.mockRejectedValue(queueError);

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(logger.error).toHaveBeenCalledWith(`Webhook processing error: ${queueError.message}`);
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Internal server error" });
      });

      it("should handle errors without message property", async () => {
        const req = createMockRequest();
        const mockStripeEvent = createMockStripeEvent();

        stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
        stripeWebhookService.parseEvent.mockReturnValue({
          id: mockStripeEvent.id,
          type: mockStripeEvent.type,
          livemode: mockStripeEvent.livemode,
          created: new Date(mockStripeEvent.created * 1000),
          data: mockStripeEvent.data,
          apiVersion: mockStripeEvent.api_version,
        });
        webhookEventRepository.findByStripeEventId.mockRejectedValue("String error");

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(logger.error).toHaveBeenCalledWith("Webhook processing error: Unknown error");
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(mockReply.send).toHaveBeenCalledWith({ error: "Internal server error" });
      });

      it("should handle non-Error objects thrown", async () => {
        const req = createMockRequest();
        const mockStripeEvent = createMockStripeEvent();

        stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
        stripeWebhookService.parseEvent.mockReturnValue({
          id: mockStripeEvent.id,
          type: mockStripeEvent.type,
          livemode: mockStripeEvent.livemode,
          created: new Date(mockStripeEvent.created * 1000),
          data: mockStripeEvent.data,
          apiVersion: mockStripeEvent.api_version,
        });
        webhookEventRepository.findByStripeEventId.mockRejectedValue({ code: "ERR_UNKNOWN" });

        await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

        expect(logger.error).toHaveBeenCalledWith("Webhook processing error: Unknown error");
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      });
    });
  });

  // ===================================================================
  // BULLMQ JOB QUEUING STRUCTURE
  // ===================================================================

  describe("POST /billing/webhooks/stripe - BullMQ Job Structure", () => {
    it("should queue job with correct job name (event type)", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent({ type: "invoice.paid" });
      const mockWebhookEvent = createMockWebhookEvent({ eventType: "invoice.paid" });

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: "invoice.paid",
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(webhookQueue.add).toHaveBeenCalledWith("invoice.paid", expect.any(Object), expect.any(Object));
    });

    it("should queue job with complete payload structure", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      const expectedPayload: WebhookJobData = {
        webhookEventId: mockWebhookEvent.id,
        stripeEventId: mockStripeEvent.id,
        eventType: mockStripeEvent.type,
        payload: mockStripeEvent.data.object as Record<string, any>,
      };

      expect(webhookQueue.add).toHaveBeenCalledWith(expect.any(String), expectedPayload, expect.any(Object));
    });

    it("should queue job with correct retry options", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(webhookQueue.add).toHaveBeenCalledWith(expect.any(String), expect.any(Object), {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      });
    });

    it("should verify all job options are correct", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      const jobOptions = (webhookQueue.add as jest.Mock).mock.calls[0][2];

      expect(jobOptions.attempts).toBe(3);
      expect(jobOptions.backoff.type).toBe("exponential");
      expect(jobOptions.backoff.delay).toBe(1000);
      expect(jobOptions.removeOnComplete).toBe(true);
      expect(jobOptions.removeOnFail).toBe(false);
    });
  });

  // ===================================================================
  // LOGGING
  // ===================================================================

  describe("POST /billing/webhooks/stripe - Logging", () => {
    it("should log warning when signature is missing", async () => {
      const req = createMockRequest();

      await controller.handleStripeWebhook(req, mockReply, "");

      expect(logger.warn).toHaveBeenCalledWith("Webhook received without signature");
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("should log error when rawBody is missing", async () => {
      const req = {
        headers: {},
        body: {},
        // rawBody is not set
      } as unknown as jest.Mocked<FastifyRequest>;

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.error).toHaveBeenCalledWith("Raw body not available for webhook verification");
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("should log warning when signature verification fails", async () => {
      const req = createMockRequest();
      const signatureError = new Error("Invalid signature provided");

      stripeWebhookService.constructEvent.mockImplementation(() => {
        throw signatureError;
      });

      await controller.handleStripeWebhook(req, mockReply, "invalid_sig");

      expect(logger.warn).toHaveBeenCalledWith(`Webhook signature verification failed: ${signatureError.message}`);
    });

    it("should log debug message for duplicate events", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const existingWebhookEvent = createMockWebhookEvent({ status: "completed" });

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(existingWebhookEvent);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.debug).toHaveBeenCalledWith(`Duplicate webhook event received: ${mockStripeEvent.id}`);
    });

    it("should log debug message when event is queued successfully", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.debug).toHaveBeenCalledWith(
        `Webhook event queued: ${mockStripeEvent.type} (${mockStripeEvent.id})`,
      );
    });

    it("should log error for internal server errors", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const internalError = new Error("Unexpected error occurred");

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockRejectedValue(internalError);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.error).toHaveBeenCalledWith(`Webhook processing error: ${internalError.message}`);
    });
  });

  // ===================================================================
  // RAW BODY BUFFER HANDLING
  // ===================================================================

  describe("POST /billing/webhooks/stripe - Raw Body Buffer Handling", () => {
    it("should handle rawBody as Buffer", async () => {
      const rawBodyBuffer = Buffer.from(JSON.stringify({ type: "test.event" }));
      const req = createMockRequest(rawBodyBuffer);
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(stripeWebhookService.constructEvent).toHaveBeenCalledWith(rawBodyBuffer, TEST_DATA.signature);
      expect(Buffer.isBuffer(rawBodyBuffer)).toBe(true);
    });

    it("should pass exact rawBody buffer to constructEvent", async () => {
      const complexPayload = {
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_123",
            metadata: { key: "value" },
            items: [{ price: "price_123" }],
          },
        },
      };
      const rawBodyBuffer = Buffer.from(JSON.stringify(complexPayload));
      const req = createMockRequest(rawBodyBuffer);
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(stripeWebhookService.constructEvent).toHaveBeenCalledWith(rawBodyBuffer, TEST_DATA.signature);
      expect((stripeWebhookService.constructEvent as jest.Mock).mock.calls[0][0]).toBe(rawBodyBuffer);
    });

    it("should verify rawBody is accessed from req.rawBody", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      // Verify that the rawBody from the request was used
      const passedRawBody = (stripeWebhookService.constructEvent as jest.Mock).mock.calls[0][0];
      expect(passedRawBody).toBe((req as any).rawBody);
    });
  });

  // ===================================================================
  // INTEGRATION TESTS
  // ===================================================================

  describe("Integration Tests", () => {
    it("should have all required dependencies injected", () => {
      expect(controller["stripeWebhookService"]).toBeDefined();
      expect(controller["webhookEventRepository"]).toBeDefined();
      expect(controller["logger"]).toBeDefined();
      expect(controller["webhookQueue"]).toBeDefined();
    });

    it("should handle complete workflow from request to queue", async () => {
      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockReturnValue(mockStripeEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: mockStripeEvent.id,
        type: mockStripeEvent.type,
        livemode: mockStripeEvent.livemode,
        created: new Date(mockStripeEvent.created * 1000),
        data: mockStripeEvent.data,
        apiVersion: mockStripeEvent.api_version,
      });
      webhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      webhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      // Verify complete workflow
      expect(stripeWebhookService.constructEvent).toHaveBeenCalledTimes(1);
      expect(stripeWebhookService.parseEvent).toHaveBeenCalledTimes(1);
      expect(webhookEventRepository.findByStripeEventId).toHaveBeenCalledTimes(1);
      expect(webhookEventRepository.create).toHaveBeenCalledTimes(1);
      expect(webhookQueue.add).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledTimes(1);
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockReply.send).toHaveBeenCalledWith({ received: true });
    });

    it("should validate execution order: signature -> body -> construct -> parse -> duplicate -> create -> queue -> log", async () => {
      const executionOrder: string[] = [];

      const req = createMockRequest();
      const mockStripeEvent = createMockStripeEvent();
      const mockWebhookEvent = createMockWebhookEvent();

      stripeWebhookService.constructEvent.mockImplementation(() => {
        executionOrder.push("constructEvent");
        return mockStripeEvent;
      });

      stripeWebhookService.parseEvent.mockImplementation(() => {
        executionOrder.push("parseEvent");
        return {
          id: mockStripeEvent.id,
          type: mockStripeEvent.type,
          livemode: mockStripeEvent.livemode,
          created: new Date(mockStripeEvent.created * 1000),
          data: mockStripeEvent.data,
          apiVersion: mockStripeEvent.api_version,
        };
      });

      webhookEventRepository.findByStripeEventId.mockImplementation(async () => {
        executionOrder.push("findByStripeEventId");
        return null;
      });

      webhookEventRepository.create.mockImplementation(async () => {
        executionOrder.push("create");
        return mockWebhookEvent;
      });

      webhookQueue.add.mockImplementation(async () => {
        executionOrder.push("queueAdd");
        return {} as any;
      });

      logger.debug.mockImplementation(() => {
        executionOrder.push("logDebug");
      });

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(executionOrder).toEqual([
        "constructEvent",
        "parseEvent",
        "findByStripeEventId",
        "create",
        "queueAdd",
        "logDebug",
      ]);
    });
  });
});
