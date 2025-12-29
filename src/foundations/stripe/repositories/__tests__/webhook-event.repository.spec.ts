// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide only what we need
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  // Create a mock Neo4jService class
  class Neo4jService {
    writeOne = jest.fn();
    readOne = jest.fn();
    readMany = jest.fn();
    initQuery = jest.fn();
  }

  // Create a mock AbstractJsonApiSerialiser class
  class AbstractJsonApiSerialiser {}

  return {
    Neo4jService,
    AbstractJsonApiSerialiser,
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookEventRepository } from "../webhook-event.repository";
import { webhookEventMeta } from "../../entities/webhook-event.meta";
import { WebhookEvent, WebhookEventStatus } from "../../entities/webhook-event.entity";

describe("WebhookEventRepository", () => {
  let repository: WebhookEventRepository;
  let neo4jService: jest.Mocked<Neo4jService>;

  // Test data constants
  const TEST_IDS = {
    eventId: "550e8400-e29b-41d4-a716-446655440000",
    stripeEventId: "evt_test123",
  };

  const COMPLEX_PAYLOAD = {
    object: "event",
    data: {
      object: {
        id: "sub_123",
        customer: "cus_456",
        items: [
          {
            id: "si_789",
            price: {
              id: "price_abc",
              product: "prod_def",
              unit_amount: 1000,
              currency: "usd",
            },
          },
        ],
        metadata: {
          custom_field: "value",
          nested: {
            deep: "data",
          },
        },
      },
      previous_attributes: {
        status: "active",
      },
    },
    livemode: true,
    pending_webhooks: 1,
    request: {
      id: "req_123",
      idempotency_key: "key_456",
    },
  };

  const MOCK_WEBHOOK_EVENT: WebhookEvent = {
    id: TEST_IDS.eventId,
    stripeEventId: TEST_IDS.stripeEventId,
    eventType: "customer.subscription.created",
    livemode: true,
    apiVersion: "2023-10-16",
    status: "pending" as WebhookEventStatus,
    payload: COMPLEX_PAYLOAD,
    retryCount: 0,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhookEventRepository, Neo4jService],
    }).compile();

    repository = module.get<WebhookEventRepository>(WebhookEventRepository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as jest.Mocked<Neo4jService>;

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${webhookEventMeta.nodeName}_id IF NOT EXISTS FOR (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName}) REQUIRE ${webhookEventMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should create unique constraint on stripeEventId field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${webhookEventMeta.nodeName}_stripeEventId IF NOT EXISTS FOR (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName}) REQUIRE ${webhookEventMeta.nodeName}.stripeEventId IS UNIQUE`,
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
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        stripeEventId: TEST_IDS.stripeEventId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName} {stripeEventId: $stripeEventId})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${webhookEventMeta.nodeName}`);
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
      const error = new Error("Database connection error");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findByStripeEventId({ stripeEventId: TEST_IDS.stripeEventId })).rejects.toThrow(
        "Database connection error",
      );
    });

    it("should preserve exact Stripe event ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const exactStripeEventId = "evt_1MvN8z3FkJ0LJ6p";

      await repository.findByStripeEventId({ stripeEventId: exactStripeEventId });

      expect(mockQuery.queryParams.stripeEventId).toBe(exactStripeEventId);
    });
  });

  describe("findPendingEvents", () => {
    const MOCK_PENDING_EVENTS: WebhookEvent[] = [
      {
        ...MOCK_WEBHOOK_EVENT,
        id: "event1",
        status: "pending",
        retryCount: 0,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        ...MOCK_WEBHOOK_EVENT,
        id: "event2",
        status: "failed",
        retryCount: 2,
        createdAt: new Date("2025-01-01T01:00:00Z"),
      },
      {
        ...MOCK_WEBHOOK_EVENT,
        id: "event3",
        status: "pending",
        retryCount: 4,
        createdAt: new Date("2025-01-01T02:00:00Z"),
      },
    ];

    it("should find pending events with default limit of 100", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue(MOCK_PENDING_EVENTS);

      const result = await repository.findPendingEvents({});

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        limit: 100,
      });
      expect(mockQuery.query).toContain(`MATCH (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName})`);
      expect(mockQuery.query).toContain(`WHERE ${webhookEventMeta.nodeName}.status IN ['pending', 'failed']`);
      expect(mockQuery.query).toContain(`AND ${webhookEventMeta.nodeName}.retryCount < 5`);
      expect(mockQuery.query).toContain(`RETURN ${webhookEventMeta.nodeName}`);
      expect(mockQuery.query).toContain(`ORDER BY ${webhookEventMeta.nodeName}.createdAt ASC`);
      expect(mockQuery.query).toContain(`LIMIT $limit`);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_PENDING_EVENTS);
    });

    it("should find pending events with custom limit", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_PENDING_EVENTS[0]]);

      const result = await repository.findPendingEvents({ limit: 10 });

      expect(mockQuery.queryParams).toEqual({
        limit: 10,
      });
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_PENDING_EVENTS[0]]);
    });

    it("should filter by status IN ['pending', 'failed']", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue(MOCK_PENDING_EVENTS);

      await repository.findPendingEvents({});

      expect(mockQuery.query).toContain("status IN ['pending', 'failed']");
    });

    it("should filter by retryCount < 5", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue(MOCK_PENDING_EVENTS);

      await repository.findPendingEvents({});

      expect(mockQuery.query).toContain("retryCount < 5");
    });

    it("should order by createdAt ASC (not DESC)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue(MOCK_PENDING_EVENTS);

      await repository.findPendingEvents({});

      expect(mockQuery.query).toContain("ORDER BY");
      expect(mockQuery.query).toContain("createdAt ASC");
      expect(mockQuery.query).not.toContain("createdAt DESC");
    });

    it("should return empty array when no pending events found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findPendingEvents({});

      expect(result).toEqual([]);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database query failed");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findPendingEvents({})).rejects.toThrow("Database query failed");
    });

    it("should handle limit of 1", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_PENDING_EVENTS[0]]);

      await repository.findPendingEvents({ limit: 1 });

      expect(mockQuery.queryParams.limit).toBe(1);
    });

    it("should handle large limit values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue(MOCK_PENDING_EVENTS);

      await repository.findPendingEvents({ limit: 1000 });

      expect(mockQuery.queryParams.limit).toBe(1000);
    });
  });

  describe("create", () => {
    const validCreateParams = {
      stripeEventId: TEST_IDS.stripeEventId,
      eventType: "customer.subscription.created",
      livemode: true,
      apiVersion: "2023-10-16" as string | null,
      payload: COMPLEX_PAYLOAD,
    };

    it("should create webhook event with all fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const result = await repository.create(validCreateParams);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams.id).toBeDefined();
      expect(mockQuery.queryParams.stripeEventId).toBe(validCreateParams.stripeEventId);
      expect(mockQuery.queryParams.eventType).toBe(validCreateParams.eventType);
      expect(mockQuery.queryParams.livemode).toBe(validCreateParams.livemode);
      expect(mockQuery.queryParams.apiVersion).toBe(validCreateParams.apiVersion);
      expect(mockQuery.queryParams.status).toBe("pending");
      expect(mockQuery.queryParams.payload).toBe(JSON.stringify(validCreateParams.payload));
      expect(mockQuery.queryParams.retryCount).toBe(0);
      expect(mockQuery.queryParams.createdAt).toBeDefined();
      expect(mockQuery.queryParams.updatedAt).toBeDefined();
      expect(mockQuery.query).toContain(`CREATE (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName}`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_WEBHOOK_EVENT);
    });

    it("should always set status to 'pending'", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.status).toBe("pending");
      expect(mockQuery.query).toContain("status: $status");
    });

    it("should always set retryCount to 0", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.retryCount).toBe(0);
      expect(mockQuery.query).toContain("retryCount: $retryCount");
    });

    it("should JSON.stringify complex nested payload", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const complexPayload = {
        level1: {
          level2: {
            level3: {
              array: [1, 2, 3],
              boolean: true,
              null: null,
              string: "test",
            },
          },
        },
      };

      await repository.create({
        ...validCreateParams,
        payload: complexPayload,
      });

      expect(mockQuery.queryParams.payload).toBe(JSON.stringify(complexPayload));
      expect(typeof mockQuery.queryParams.payload).toBe("string");
    });

    it("should handle apiVersion as null", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create({
        ...validCreateParams,
        apiVersion: null,
      });

      expect(mockQuery.queryParams.apiVersion).toBeNull();
    });

    it("should handle apiVersion as string", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create({
        ...validCreateParams,
        apiVersion: "2024-01-15",
      });

      expect(mockQuery.queryParams.apiVersion).toBe("2024-01-15");
    });

    it("should convert createdAt to ISO string", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.createdAt).toBeDefined();
      expect(typeof mockQuery.queryParams.createdAt).toBe("string");
      expect(() => new Date(mockQuery.queryParams.createdAt)).not.toThrow();
      expect(mockQuery.query).toContain("createdAt: datetime($createdAt)");
    });

    it("should convert updatedAt to ISO string", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.updatedAt).toBeDefined();
      expect(typeof mockQuery.queryParams.updatedAt).toBe("string");
      expect(() => new Date(mockQuery.queryParams.updatedAt)).not.toThrow();
      expect(mockQuery.query).toContain("updatedAt: datetime($updatedAt)");
    });

    it("should generate unique UUID for each event", async () => {
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

    it("should handle livemode as true", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create({
        ...validCreateParams,
        livemode: true,
      });

      expect(mockQuery.queryParams.livemode).toBe(true);
    });

    it("should handle livemode as false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create({
        ...validCreateParams,
        livemode: false,
      });

      expect(mockQuery.queryParams.livemode).toBe(false);
    });

    it("should handle creation errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Creation failed - duplicate stripeEventId");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.create(validCreateParams)).rejects.toThrow("Creation failed - duplicate stripeEventId");
    });

    it("should preserve exact parameter values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const exactParams = {
        stripeEventId: "evt_exact_123",
        eventType: "invoice.payment_succeeded",
        livemode: false,
        apiVersion: "2024-11-20.acacia",
        payload: { exact: "data" },
      };

      await repository.create(exactParams);

      expect(mockQuery.queryParams.stripeEventId).toBe(exactParams.stripeEventId);
      expect(mockQuery.queryParams.eventType).toBe(exactParams.eventType);
      expect(mockQuery.queryParams.livemode).toBe(exactParams.livemode);
      expect(mockQuery.queryParams.apiVersion).toBe(exactParams.apiVersion);
      expect(mockQuery.queryParams.payload).toBe(JSON.stringify(exactParams.payload));
    });

    it("should handle empty payload object", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create({
        ...validCreateParams,
        payload: {},
      });

      expect(mockQuery.queryParams.payload).toBe("{}");
    });

    it("should handle payload with special characters", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const payloadWithSpecialChars = {
        text: "Line 1\nLine 2\tTabbed",
        quote: 'He said "hello"',
        backslash: "path\\to\\file",
      };

      await repository.create({
        ...validCreateParams,
        payload: payloadWithSpecialChars,
      });

      expect(mockQuery.queryParams.payload).toBe(JSON.stringify(payloadWithSpecialChars));
      const parsed = JSON.parse(mockQuery.queryParams.payload);
      expect(parsed).toEqual(payloadWithSpecialChars);
    });

    it("should handle payload with arrays", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const payloadWithArrays = {
        items: [1, 2, 3],
        nested: [
          [1, 2],
          [3, 4],
        ],
        mixed: [1, "two", { three: 3 }, [4]],
      };

      await repository.create({
        ...validCreateParams,
        payload: payloadWithArrays,
      });

      const parsed = JSON.parse(mockQuery.queryParams.payload);
      expect(parsed).toEqual(payloadWithArrays);
    });
  });

  describe("updateStatus", () => {
    it("should update status to 'processing'", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const params = {
        id: TEST_IDS.eventId,
        status: "processing" as WebhookEventStatus,
      };

      const result = await repository.updateStatus(params);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams.id).toBe(TEST_IDS.eventId);
      expect(mockQuery.queryParams.status).toBe("processing");
      expect(mockQuery.queryParams.updatedAt).toBeDefined();
      expect(mockQuery.query).toContain(`MATCH (${webhookEventMeta.nodeName}:${webhookEventMeta.labelName} {id: $id})`);
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.updatedAt = datetime($updatedAt)`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_WEBHOOK_EVENT);
    });

    it("should update status to 'completed'", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "completed" as WebhookEventStatus,
      });

      expect(mockQuery.queryParams.status).toBe("completed");
    });

    it("should update status to 'failed'", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "failed" as WebhookEventStatus,
      });

      expect(mockQuery.queryParams.status).toBe("failed");
    });

    it("should update status to 'pending'", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "pending" as WebhookEventStatus,
      });

      expect(mockQuery.queryParams.status).toBe("pending");
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "completed" as WebhookEventStatus,
      });

      expect(mockQuery.queryParams.updatedAt).toBeDefined();
      expect(typeof mockQuery.queryParams.updatedAt).toBe("string");
      expect(() => new Date(mockQuery.queryParams.updatedAt)).not.toThrow();
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.updatedAt = datetime($updatedAt)`);
    });

    it("should update processedAt when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const processedAt = new Date("2025-01-15T12:30:00Z");

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "completed" as WebhookEventStatus,
        processedAt,
      });

      expect(mockQuery.queryParams.processedAt).toBe(processedAt.toISOString());
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.processedAt = datetime($processedAt)`);
    });

    it("should not update processedAt when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "processing" as WebhookEventStatus,
      });

      expect(mockQuery.queryParams.processedAt).toBeUndefined();
      expect(mockQuery.query).not.toContain("processedAt");
    });

    it("should update error when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const errorMessage = "Failed to process webhook: Connection timeout";

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "failed" as WebhookEventStatus,
        error: errorMessage,
      });

      expect(mockQuery.queryParams.error).toBe(errorMessage);
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.error = $error`);
    });

    it("should update error to empty string", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "failed" as WebhookEventStatus,
        error: "",
      });

      expect(mockQuery.queryParams.error).toBe("");
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.error = $error`);
    });

    it("should not update error when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "processing" as WebhookEventStatus,
      });

      expect(mockQuery.queryParams.error).toBeUndefined();
      expect(mockQuery.query).not.toContain(".error = $error");
    });

    it("should increment retryCount when incrementRetryCount is true", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "failed" as WebhookEventStatus,
        incrementRetryCount: true,
      });

      expect(mockQuery.query).toContain(
        `${webhookEventMeta.nodeName}.retryCount = ${webhookEventMeta.nodeName}.retryCount + 1`,
      );
      expect(mockQuery.query).not.toContain("retryCount: $retryCount");
    });

    it("should not increment retryCount when incrementRetryCount is false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "processing" as WebhookEventStatus,
        incrementRetryCount: false,
      });

      expect(mockQuery.query).not.toContain("retryCount");
    });

    it("should not increment retryCount when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "processing" as WebhookEventStatus,
      });

      expect(mockQuery.query).not.toContain("retryCount");
    });

    it("should update multiple fields at once", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const processedAt = new Date("2025-01-15T12:30:00Z");

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "failed" as WebhookEventStatus,
        processedAt,
        error: "Retry limit exceeded",
        incrementRetryCount: true,
      });

      expect(mockQuery.queryParams.status).toBe("failed");
      expect(mockQuery.queryParams.processedAt).toBe(processedAt.toISOString());
      expect(mockQuery.queryParams.error).toBe("Retry limit exceeded");
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.processedAt = datetime($processedAt)`);
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.error = $error`);
      expect(mockQuery.query).toContain(
        `${webhookEventMeta.nodeName}.retryCount = ${webhookEventMeta.nodeName}.retryCount + 1`,
      );
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.updatedAt = datetime($updatedAt)`);
    });

    it("should use conditional SET clauses based on optional parameters", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "completed" as WebhookEventStatus,
        processedAt: new Date(),
      });

      const setClausesCount = (mockQuery.query.match(/SET/g) || []).length;
      expect(setClausesCount).toBe(1);
      expect(mockQuery.query).toContain(", ");
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - event not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updateStatus({
          id: TEST_IDS.eventId,
          status: "completed" as WebhookEventStatus,
        }),
      ).rejects.toThrow("Update failed - event not found");
    });

    it("should handle long error messages", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const longError = "Error: " + "x".repeat(1000);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "failed" as WebhookEventStatus,
        error: longError,
      });

      expect(mockQuery.queryParams.error).toBe(longError);
    });

    it("should handle error with special characters", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const errorWithSpecialChars = 'Error: "Connection failed"\nStack trace:\n\tat line 1';

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "failed" as WebhookEventStatus,
        error: errorWithSpecialChars,
      });

      expect(mockQuery.queryParams.error).toBe(errorWithSpecialChars);
    });

    it("should handle status update with all optional fields omitted", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "processing" as WebhookEventStatus,
      });

      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(`${webhookEventMeta.nodeName}.updatedAt = datetime($updatedAt)`);
      expect(mockQuery.query).not.toContain("processedAt");
      expect(mockQuery.query).not.toContain("error");
      expect(mockQuery.query).not.toContain("retryCount");
    });

    it("should use arithmetic increment for retryCount (not parameter)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "failed" as WebhookEventStatus,
        incrementRetryCount: true,
      });

      expect(mockQuery.query).toContain("retryCount = webhookEvent.retryCount + 1");
      expect(mockQuery.queryParams).not.toHaveProperty("retryCount");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string eventType", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "",
        livemode: true,
        apiVersion: null,
        payload: {},
      });

      expect(mockQuery.queryParams.eventType).toBe("");
    });

    it("should handle very long eventType", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const longEventType = "very.long.event.type." + "segment.".repeat(50) + "end";

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: longEventType,
        livemode: true,
        apiVersion: null,
        payload: {},
      });

      expect(mockQuery.queryParams.eventType).toBe(longEventType);
    });

    it("should handle payload with null values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const payloadWithNulls = {
        field1: null,
        field2: "value",
        nested: {
          field3: null,
        },
      };

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: true,
        apiVersion: null,
        payload: payloadWithNulls,
      });

      const parsed = JSON.parse(mockQuery.queryParams.payload);
      expect(parsed).toEqual(payloadWithNulls);
    });

    it("should handle payload with unicode characters", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const payloadWithUnicode = {
        emoji: "🎉💯✨",
        chinese: "你好世界",
        arabic: "مرحبا بالعالم",
        symbols: "© ® ™ € £ ¥",
      };

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: true,
        apiVersion: null,
        payload: payloadWithUnicode,
      });

      const parsed = JSON.parse(mockQuery.queryParams.payload);
      expect(parsed).toEqual(payloadWithUnicode);
    });

    it("should handle very large payload objects", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      const largePayload = {
        data: Array.from({ length: 100 }, (_, i) => ({
          id: `item_${i}`,
          value: i,
          metadata: {
            field1: "value1",
            field2: "value2",
            nested: {
              deep: "data",
            },
          },
        })),
      };

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: true,
        apiVersion: null,
        payload: largePayload,
      });

      const parsed = JSON.parse(mockQuery.queryParams.payload);
      expect(parsed).toEqual(largePayload);
      expect(parsed.data).toHaveLength(100);
    });

    it("should handle payload with deeply nested structures", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      let deepPayload: any = { value: "end" };
      for (let i = 0; i < 20; i++) {
        deepPayload = { nested: deepPayload };
      }

      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: true,
        apiVersion: null,
        payload: deepPayload,
      });

      const parsed = JSON.parse(mockQuery.queryParams.payload);
      expect(parsed).toEqual(deepPayload);
    });

    it("should handle null return from findByStripeEventId gracefully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripeEventId({ stripeEventId: "evt_nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery before each operation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);
      neo4jService.readMany.mockResolvedValue([MOCK_WEBHOOK_EVENT]);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.findByStripeEventId({ stripeEventId: TEST_IDS.stripeEventId });
      await repository.findPendingEvents({});
      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: true,
        apiVersion: null,
        payload: {},
      });
      await repository.updateStatus({
        id: TEST_IDS.eventId,
        status: "completed" as WebhookEventStatus,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(4);
    });

    it("should use WebhookEventModel serialiser for all operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);
      neo4jService.writeOne.mockResolvedValue(MOCK_WEBHOOK_EVENT);

      await repository.findByStripeEventId({ stripeEventId: TEST_IDS.stripeEventId });
      await repository.create({
        stripeEventId: TEST_IDS.stripeEventId,
        eventType: "test.event",
        livemode: true,
        apiVersion: null,
        payload: {},
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
    });
  });
});
