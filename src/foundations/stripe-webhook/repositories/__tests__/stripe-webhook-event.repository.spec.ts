import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { Neo4jService } from "../../../../core/neo4j";
import { StripeWebhookEventRepository } from "../stripe-webhook-event.repository";
import { stripeWebhookEventMeta } from "../../entities/stripe-webhook-event.meta";
import { StripeWebhookEventModel } from "../../entities/stripe-webhook-event.model";
import { StripeWebhookEvent, StripeWebhookEventStatus } from "../../entities/stripe-webhook-event.entity";

describe("StripeWebhookEventRepository", () => {
  let repository: StripeWebhookEventRepository;
  let neo4jService: vi.Mocked<Neo4jService>;

  // Test data constants
  const TEST_IDS = {
    webhookEventId: "550e8400-e29b-41d4-a716-446655440000",
    stripeEventId: "evt_test_12345678",
  };

  const MOCK_WEBHOOK_EVENT: StripeWebhookEvent = {
    id: TEST_IDS.webhookEventId,
    stripeEventId: TEST_IDS.stripeEventId,
    eventType: "customer.subscription.created",
    livemode: false,
    apiVersion: "2024-11-20.acacia",
    status: "pending",
    payload: { id: "sub_test_123", object: "subscription" },
    retryCount: 0,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    const mockNeo4jService = {
      writeOne: vi.fn(),
      readOne: vi.fn(),
      readMany: vi.fn(),
      initQuery: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookEventRepository,
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
      ],
    }).compile();

    repository = module.get<StripeWebhookEventRepository>(StripeWebhookEventRepository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as vi.Mocked<Neo4jService>;

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${stripeWebhookEventMeta.nodeName}_id IF NOT EXISTS FOR (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName}) REQUIRE ${stripeWebhookEventMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should create unique constraint on stripeEventId field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${stripeWebhookEventMeta.nodeName}_stripeEventId IF NOT EXISTS FOR (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName}) REQUIRE ${stripeWebhookEventMeta.nodeName}.stripeEventId IS UNIQUE`,
      });
    });

    it("should create both constraints in sequence", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should handle constraint creation errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findByStripeEventId", () => {
    it("should find webhook event by Stripe event ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const result = await repository.findByStripeEventId({ stripeEventId: TEST_IDS.stripeEventId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: StripeWebhookEventModel,
      });
      expect(mockQuery.queryParams).toEqual({
        stripeEventId: TEST_IDS.stripeEventId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName} {stripeEventId: $stripeEventId})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${stripeWebhookEventMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_WEBHOOK_EVENT);
    });

    it("should return null when webhook event not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripeEventId({ stripeEventId: "evt_nonexistent" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database error");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findByStripeEventId({ stripeEventId: TEST_IDS.stripeEventId })).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("findPendingEvents", () => {
    it("should find pending events with default limit", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_WEBHOOK_EVENT]);

      const result = await repository.findPendingEvents({});

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: StripeWebhookEventModel,
      });
      expect(mockQuery.queryParams).toEqual({
        limit: 100,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.status IN ['pending', 'failed']`);
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.retryCount < 5`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripeWebhookEventMeta.nodeName}.createdAt ASC`);
      expect(mockQuery.query).toContain(`LIMIT $limit`);
      expect(result).toEqual([MOCK_WEBHOOK_EVENT]);
    });

    it("should find pending events with custom limit", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_WEBHOOK_EVENT]);

      await repository.findPendingEvents({ limit: 50 });

      expect(mockQuery.queryParams).toEqual({
        limit: 50,
      });
    });

    it("should return empty array when no pending events found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findPendingEvents({});

      expect(result).toEqual([]);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findPendingEvents({})).rejects.toThrow("Database connection error");
    });
  });

  describe("create", () => {
    const validCreateParams = {
      stripeEventId: TEST_IDS.stripeEventId,
      eventType: "customer.subscription.created",
      livemode: false,
      apiVersion: "2024-11-20.acacia",
      payload: { id: "sub_123", object: "subscription" },
    };

    it("should create webhook event with all required fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const result = await repository.create(validCreateParams);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: StripeWebhookEventModel,
      });
      expect(mockQuery.queryParams).toMatchObject({
        stripeEventId: validCreateParams.stripeEventId,
        eventType: validCreateParams.eventType,
        livemode: validCreateParams.livemode,
        apiVersion: validCreateParams.apiVersion,
        status: "pending",
        payload: JSON.stringify(validCreateParams.payload),
        retryCount: 0,
      });
      expect(mockQuery.queryParams.id).toBeDefined();
      expect(mockQuery.query).toContain(
        `CREATE (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName}`,
      );
      expect(mockQuery.query).toContain("createdAt: datetime($createdAt)");
      expect(mockQuery.query).toContain("updatedAt: datetime($updatedAt)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_WEBHOOK_EVENT);
    });

    it("should handle null apiVersion", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const paramsWithNullApiVersion = {
        ...validCreateParams,
        apiVersion: null,
      };

      await repository.create(paramsWithNullApiVersion);

      expect(mockQuery.queryParams.apiVersion).toBeNull();
    });

    it("should generate unique UUID for each webhook event", async () => {
      const mockQuery1 = createMockQuery();
      const mockQuery2 = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(mockQuery1).mockReturnValueOnce(mockQuery2);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create(validCreateParams);
      await repository.create(validCreateParams);

      expect(mockQuery1.queryParams.id).toBeDefined();
      expect(mockQuery2.queryParams.id).toBeDefined();
      expect(mockQuery1.queryParams.id).not.toEqual(mockQuery2.queryParams.id);
    });

    it("should JSON stringify the payload", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const complexPayload = {
        id: "sub_123",
        object: "subscription",
        nested: {
          items: [{ id: "si_123" }],
        },
      };

      await repository.create({
        ...validCreateParams,
        payload: complexPayload,
      });

      expect(mockQuery.queryParams.payload).toBe(JSON.stringify(complexPayload));
    });

    it("should set initial retryCount to 0", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.retryCount).toBe(0);
    });

    it("should set initial status to pending", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.status).toBe("pending");
    });

    it("should handle creation errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Creation failed - duplicate event");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.create(validCreateParams)).rejects.toThrow("Creation failed - duplicate event");
    });
  });

  describe("updateStatus", () => {
    it("should update status field only", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const params = {
        id: TEST_IDS.webhookEventId,
        status: "processing" as StripeWebhookEventStatus,
      };

      const result = await repository.updateStatus(params);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: StripeWebhookEventModel,
      });
      expect(mockQuery.queryParams).toMatchObject({
        id: TEST_IDS.webhookEventId,
        status: "processing",
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeWebhookEventMeta.nodeName}:${stripeWebhookEventMeta.labelName} {id: $id})`,
      );
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.updatedAt = datetime($updatedAt)`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_WEBHOOK_EVENT);
    });

    it("should update status with processedAt", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const processedAt = new Date();
      const params = {
        id: TEST_IDS.webhookEventId,
        status: "completed" as StripeWebhookEventStatus,
        processedAt,
      };

      await repository.updateStatus(params);

      expect(mockQuery.queryParams.processedAt).toBe(processedAt.toISOString());
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.processedAt = datetime($processedAt)`);
    });

    it("should update status with error message", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const params = {
        id: TEST_IDS.webhookEventId,
        status: "failed" as StripeWebhookEventStatus,
        error: "Payment processing failed",
      };

      await repository.updateStatus(params);

      expect(mockQuery.queryParams.error).toBe("Payment processing failed");
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.error = $error`);
    });

    it("should increment retry count when specified", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const params = {
        id: TEST_IDS.webhookEventId,
        status: "failed" as StripeWebhookEventStatus,
        incrementRetryCount: true,
      };

      await repository.updateStatus(params);

      expect(mockQuery.query).toContain(
        `${stripeWebhookEventMeta.nodeName}.retryCount = ${stripeWebhookEventMeta.nodeName}.retryCount + 1`,
      );
    });

    it("should update with all optional fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const processedAt = new Date();
      const params = {
        id: TEST_IDS.webhookEventId,
        status: "failed" as StripeWebhookEventStatus,
        processedAt,
        error: "Connection timeout",
        incrementRetryCount: true,
      };

      await repository.updateStatus(params);

      expect(mockQuery.queryParams).toMatchObject({
        id: TEST_IDS.webhookEventId,
        status: "failed",
        processedAt: processedAt.toISOString(),
        error: "Connection timeout",
      });
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.processedAt = datetime($processedAt)`);
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.error = $error`);
      expect(mockQuery.query).toContain(
        `${stripeWebhookEventMeta.nodeName}.retryCount = ${stripeWebhookEventMeta.nodeName}.retryCount + 1`,
      );
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.webhookEventId,
        status: "processing",
      });

      expect(mockQuery.queryParams.updatedAt).toBeDefined();
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.updatedAt = datetime($updatedAt)`);
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - event not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updateStatus({
          id: TEST_IDS.webhookEventId,
          status: "processing",
        }),
      ).rejects.toThrow("Update failed - event not found");
    });

    it("should handle empty error string", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.webhookEventId,
        status: "failed",
        error: "",
      });

      expect(mockQuery.queryParams.error).toBe("");
      expect(mockQuery.query).toContain(`${stripeWebhookEventMeta.nodeName}.error = $error`);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty payload in create", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: false,
        apiVersion: "2024-11-20.acacia",
        payload: {},
      });

      expect(mockQuery.queryParams.payload).toBe("{}");
    });

    it("should handle complex nested payload", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const complexPayload = {
        object: "subscription",
        items: {
          data: [
            {
              id: "si_123",
              price: {
                id: "price_123",
                product: "prod_123",
              },
            },
          ],
        },
        metadata: {
          key1: "value1",
          key2: "value2",
        },
      };

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: false,
        apiVersion: "2024-11-20.acacia",
        payload: complexPayload,
      });

      expect(mockQuery.queryParams.payload).toBe(JSON.stringify(complexPayload));
    });

    it("should preserve exact event ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const exactEventId = "evt_1N2abCdEfGhIjKlMnOpQrStU";

      await repository.findByStripeEventId({ stripeEventId: exactEventId });

      expect(mockQuery.queryParams.stripeEventId).toBe(exactEventId);
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery before each read operation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);
      neo4jService.readMany.mockResolvedValue([MOCK_WEBHOOK_EVENT]);

      await repository.findByStripeEventId({ stripeEventId: TEST_IDS.stripeEventId });
      await repository.findPendingEvents({});

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(2);
    });

    it("should call Neo4jService.writeOne for create and update operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: false,
        apiVersion: "2024-11-20.acacia",
        payload: {},
      });

      await repository.updateStatus({
        id: TEST_IDS.webhookEventId,
        status: "completed",
      });

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });
  });
});
