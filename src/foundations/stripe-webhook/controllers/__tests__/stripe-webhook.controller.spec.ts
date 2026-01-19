import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { FastifyReply, FastifyRequest } from "fastify";
import { Queue } from "bullmq";
import { StripeWebhookController } from "../stripe-webhook.controller";
import { StripeWebhookService } from "../../services/stripe-webhook.service";
import { StripeWebhookEventRepository } from "../../repositories/stripe-webhook-event.repository";
import { StripeWebhookJobData } from "../../processors/stripe-webhook.processor";
import { AppLoggingService } from "../../../../core/logging";
import { QueueId } from "../../../../config/enums/queue.id";
import { MOCK_WEBHOOK_EVENT, TEST_IDS } from "../../../stripe/__tests__/fixtures/stripe.fixtures";
import Stripe from "stripe";

describe("StripeWebhookController", () => {
  let controller: StripeWebhookController;
  let stripeWebhookService: vi.Mocked<StripeWebhookService>;
  let stripeWebhookEventRepository: vi.Mocked<StripeWebhookEventRepository>;
  let webhookQueue: vi.Mocked<Queue<StripeWebhookJobData>>;
  let logger: vi.Mocked<AppLoggingService>;
  let mockReply: vi.Mocked<FastifyReply>;

  const TEST_DATA = {
    signature: "t=1234567890,v1=signature_hash_abc123",
    webhookEventId: "550e8400-e29b-41d4-a716-446655440000",
    stripeEventId: "evt_test_12345678",
    eventType: "customer.subscription.created",
  };

  const MOCK_WEBHOOK_EVENT_ENTITY = {
    id: TEST_DATA.webhookEventId,
    stripeEventId: TEST_DATA.stripeEventId,
    eventType: TEST_DATA.eventType,
    livemode: false,
    apiVersion: "2024-11-20.acacia",
    status: "pending" as const,
    payload: {},
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Create a mock Fastify request with rawBody
  const createMockRequest = (): FastifyRequest => {
    const req = {
      rawBody: Buffer.from(JSON.stringify({ test: "payload" })),
    } as unknown as FastifyRequest;
    return req;
  };

  // Create a mock Fastify reply
  const createMockReply = (): vi.Mocked<FastifyReply> => {
    const reply = {
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as vi.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockStripeWebhookService = {
      constructEvent: vi.fn(),
      parseEvent: vi.fn(),
    };

    const mockStripeWebhookEventRepository = {
      findByStripeEventId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
    };

    const mockQueue = {
      add: vi.fn(),
    };

    const mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        {
          provide: StripeWebhookService,
          useValue: mockStripeWebhookService,
        },
        {
          provide: StripeWebhookEventRepository,
          useValue: mockStripeWebhookEventRepository,
        },
        {
          provide: getQueueToken(QueueId.BILLING_WEBHOOK),
          useValue: mockQueue,
        },
        {
          provide: AppLoggingService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    controller = module.get<StripeWebhookController>(StripeWebhookController);
    stripeWebhookService = module.get(StripeWebhookService);
    stripeWebhookEventRepository = module.get(StripeWebhookEventRepository);
    webhookQueue = module.get(getQueueToken(QueueId.BILLING_WEBHOOK));
    logger = module.get(AppLoggingService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("handleStripeWebhook", () => {
    it("should process webhook successfully and queue event", async () => {
      const req = createMockRequest();
      stripeWebhookService.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: MOCK_WEBHOOK_EVENT.id,
        type: MOCK_WEBHOOK_EVENT.type,
        livemode: MOCK_WEBHOOK_EVENT.livemode,
        created: new Date(MOCK_WEBHOOK_EVENT.created * 1000),
        data: MOCK_WEBHOOK_EVENT.data,
        apiVersion: MOCK_WEBHOOK_EVENT.api_version,
      });
      stripeWebhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      stripeWebhookEventRepository.create.mockResolvedValue(MOCK_WEBHOOK_EVENT_ENTITY);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(stripeWebhookService.constructEvent).toHaveBeenCalledWith((req as any).rawBody, TEST_DATA.signature);
      expect(stripeWebhookEventRepository.findByStripeEventId).toHaveBeenCalledWith({
        stripeEventId: MOCK_WEBHOOK_EVENT.id,
      });
      expect(stripeWebhookEventRepository.create).toHaveBeenCalledWith({
        stripeEventId: MOCK_WEBHOOK_EVENT.id,
        eventType: MOCK_WEBHOOK_EVENT.type,
        livemode: MOCK_WEBHOOK_EVENT.livemode,
        apiVersion: MOCK_WEBHOOK_EVENT.api_version,
        payload: MOCK_WEBHOOK_EVENT.data.object,
      });
      expect(webhookQueue.add).toHaveBeenCalledWith(
        MOCK_WEBHOOK_EVENT.type,
        expect.objectContaining({
          webhookEventId: MOCK_WEBHOOK_EVENT_ENTITY.id,
          stripeEventId: MOCK_WEBHOOK_EVENT.id,
          eventType: MOCK_WEBHOOK_EVENT.type,
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
        }),
      );
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockReply.send).toHaveBeenCalledWith({ received: true });
    });

    it("should return BAD_REQUEST when signature is missing", async () => {
      const req = createMockRequest();

      await controller.handleStripeWebhook(req, mockReply, "");

      expect(logger.warn).toHaveBeenCalledWith("Webhook received without signature");
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Missing stripe-signature header" });
      expect(stripeWebhookService.constructEvent).not.toHaveBeenCalled();
    });

    it("should return BAD_REQUEST when rawBody is not available", async () => {
      const req = {} as FastifyRequest;

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.error).toHaveBeenCalledWith("Raw body not available for webhook verification");
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Raw body not available" });
    });

    it("should return OK with duplicate flag when event already exists", async () => {
      const req = createMockRequest();
      stripeWebhookService.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: MOCK_WEBHOOK_EVENT.id,
        type: MOCK_WEBHOOK_EVENT.type,
        livemode: MOCK_WEBHOOK_EVENT.livemode,
        created: new Date(MOCK_WEBHOOK_EVENT.created * 1000),
        data: MOCK_WEBHOOK_EVENT.data,
        apiVersion: MOCK_WEBHOOK_EVENT.api_version,
      });
      stripeWebhookEventRepository.findByStripeEventId.mockResolvedValue(MOCK_WEBHOOK_EVENT_ENTITY);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.debug).toHaveBeenCalledWith(`Duplicate webhook event received: ${MOCK_WEBHOOK_EVENT.id}`);
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockReply.send).toHaveBeenCalledWith({ received: true, duplicate: true });
      expect(stripeWebhookEventRepository.create).not.toHaveBeenCalled();
      expect(webhookQueue.add).not.toHaveBeenCalled();
    });

    it("should return BAD_REQUEST when signature verification fails", async () => {
      const req = createMockRequest();
      const signatureError = new Error("Invalid signature");
      stripeWebhookService.constructEvent.mockImplementation(() => {
        throw signatureError;
      });

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Webhook signature verification failed"));
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Webhook signature verification failed" });
    });

    it("should return INTERNAL_SERVER_ERROR for other errors", async () => {
      const req = createMockRequest();
      stripeWebhookService.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: MOCK_WEBHOOK_EVENT.id,
        type: MOCK_WEBHOOK_EVENT.type,
        livemode: MOCK_WEBHOOK_EVENT.livemode,
        created: new Date(MOCK_WEBHOOK_EVENT.created * 1000),
        data: MOCK_WEBHOOK_EVENT.data,
        apiVersion: MOCK_WEBHOOK_EVENT.api_version,
      });
      stripeWebhookEventRepository.findByStripeEventId.mockRejectedValue(new Error("Database error"));

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Webhook processing error"));
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Internal server error" });
    });

    it("should handle unknown error types gracefully", async () => {
      const req = createMockRequest();
      stripeWebhookService.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: MOCK_WEBHOOK_EVENT.id,
        type: MOCK_WEBHOOK_EVENT.type,
        livemode: MOCK_WEBHOOK_EVENT.livemode,
        created: new Date(MOCK_WEBHOOK_EVENT.created * 1000),
        data: MOCK_WEBHOOK_EVENT.data,
        apiVersion: MOCK_WEBHOOK_EVENT.api_version,
      });
      stripeWebhookEventRepository.findByStripeEventId.mockRejectedValue("string error");

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.error).toHaveBeenCalledWith("Webhook processing error: Unknown error");
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Internal server error" });
    });

    it("should queue event with correct job options", async () => {
      const req = createMockRequest();
      stripeWebhookService.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: MOCK_WEBHOOK_EVENT.id,
        type: MOCK_WEBHOOK_EVENT.type,
        livemode: MOCK_WEBHOOK_EVENT.livemode,
        created: new Date(MOCK_WEBHOOK_EVENT.created * 1000),
        data: MOCK_WEBHOOK_EVENT.data,
        apiVersion: MOCK_WEBHOOK_EVENT.api_version,
      });
      stripeWebhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      stripeWebhookEventRepository.create.mockResolvedValue(MOCK_WEBHOOK_EVENT_ENTITY);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(webhookQueue.add).toHaveBeenCalledWith(
        MOCK_WEBHOOK_EVENT.type,
        {
          webhookEventId: MOCK_WEBHOOK_EVENT_ENTITY.id,
          stripeEventId: MOCK_WEBHOOK_EVENT.id,
          eventType: MOCK_WEBHOOK_EVENT.type,
          payload: MOCK_WEBHOOK_EVENT.data.object,
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
    });

    it("should log debug message when event is queued", async () => {
      const req = createMockRequest();
      stripeWebhookService.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: MOCK_WEBHOOK_EVENT.id,
        type: MOCK_WEBHOOK_EVENT.type,
        livemode: MOCK_WEBHOOK_EVENT.livemode,
        created: new Date(MOCK_WEBHOOK_EVENT.created * 1000),
        data: MOCK_WEBHOOK_EVENT.data,
        apiVersion: MOCK_WEBHOOK_EVENT.api_version,
      });
      stripeWebhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      stripeWebhookEventRepository.create.mockResolvedValue(MOCK_WEBHOOK_EVENT_ENTITY);
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(logger.debug).toHaveBeenCalledWith(
        `Webhook event queued: ${MOCK_WEBHOOK_EVENT.type} (${MOCK_WEBHOOK_EVENT.id})`,
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined signature", async () => {
      const req = createMockRequest();

      await controller.handleStripeWebhook(req, mockReply, undefined as any);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Missing stripe-signature header" });
    });

    it("should handle null signature", async () => {
      const req = createMockRequest();

      await controller.handleStripeWebhook(req, mockReply, null as any);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Missing stripe-signature header" });
    });

    it("should process different event types correctly", async () => {
      const req = createMockRequest();
      const invoiceEvent: Stripe.Event = {
        ...MOCK_WEBHOOK_EVENT,
        id: "evt_invoice_test",
        type: "invoice.paid",
      };
      stripeWebhookService.constructEvent.mockReturnValue(invoiceEvent);
      stripeWebhookService.parseEvent.mockReturnValue({
        id: invoiceEvent.id,
        type: invoiceEvent.type,
        livemode: invoiceEvent.livemode,
        created: new Date(invoiceEvent.created * 1000),
        data: invoiceEvent.data,
        apiVersion: invoiceEvent.api_version,
      });
      stripeWebhookEventRepository.findByStripeEventId.mockResolvedValue(null);
      stripeWebhookEventRepository.create.mockResolvedValue({
        ...MOCK_WEBHOOK_EVENT_ENTITY,
        stripeEventId: invoiceEvent.id,
        eventType: invoiceEvent.type,
      });
      webhookQueue.add.mockResolvedValue({} as any);

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(webhookQueue.add).toHaveBeenCalledWith(
        "invoice.paid",
        expect.objectContaining({
          eventType: "invoice.paid",
          stripeEventId: "evt_invoice_test",
        }),
        expect.any(Object),
      );
    });
  });

  describe("Service Integration", () => {
    it("should call services in correct order", async () => {
      const callOrder: string[] = [];
      const req = createMockRequest();

      stripeWebhookService.constructEvent.mockImplementation(() => {
        callOrder.push("constructEvent");
        return MOCK_WEBHOOK_EVENT;
      });
      stripeWebhookService.parseEvent.mockImplementation(() => {
        callOrder.push("parseEvent");
        return {
          id: MOCK_WEBHOOK_EVENT.id,
          type: MOCK_WEBHOOK_EVENT.type,
          livemode: MOCK_WEBHOOK_EVENT.livemode,
          created: new Date(MOCK_WEBHOOK_EVENT.created * 1000),
          data: MOCK_WEBHOOK_EVENT.data,
          apiVersion: MOCK_WEBHOOK_EVENT.api_version,
        };
      });
      stripeWebhookEventRepository.findByStripeEventId.mockImplementation(async () => {
        callOrder.push("findByStripeEventId");
        return null;
      });
      stripeWebhookEventRepository.create.mockImplementation(async () => {
        callOrder.push("create");
        return MOCK_WEBHOOK_EVENT_ENTITY;
      });
      webhookQueue.add.mockImplementation(async () => {
        callOrder.push("queueAdd");
        return {} as any;
      });

      await controller.handleStripeWebhook(req, mockReply, TEST_DATA.signature);

      expect(callOrder).toEqual(["constructEvent", "parseEvent", "findByStripeEventId", "create", "queueAdd"]);
    });
  });
});
