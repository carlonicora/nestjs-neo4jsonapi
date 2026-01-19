import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { Neo4jService } from "../../../../core/neo4j";
import { StripeSubscriptionRepository } from "../stripe-subscription.repository";
import { stripeSubscriptionMeta } from "../../entities/stripe-subscription.meta";
import { stripeCustomerMeta } from "../../../stripe-customer/entities/stripe-customer.meta";
import { stripePriceMeta } from "../../../stripe-price/entities/stripe-price.meta";
import { stripeProductMeta } from "../../../stripe-product/entities/stripe-product.meta";
import { StripeSubscription, StripeSubscriptionStatus } from "../../entities/stripe-subscription.entity";

describe("StripeSubscriptionRepository", () => {
  let repository: StripeSubscriptionRepository;
  let neo4jService: vi.Mocked<Neo4jService>;

  // Test data constants
  const TEST_IDS = {
    subscriptionId: "550e8400-e29b-41d4-a716-446655440000",
    stripeCustomerId: "660e8400-e29b-41d4-a716-446655440001",
    priceId: "770e8400-e29b-41d4-a716-446655440002",
    stripeSubscriptionId: "sub_test123",
    stripeSubscriptionItemId: "si_test456",
    stripeCustomerId: "cus_test789",
  };

  const MOCK_DATES = {
    currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2025-02-01T00:00:00Z"),
    trialStart: new Date("2025-01-01T00:00:00Z"),
    trialEnd: new Date("2025-01-15T00:00:00Z"),
    canceledAt: new Date("2025-01-20T00:00:00Z"),
    pausedAt: new Date("2025-01-25T00:00:00Z"),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const MOCK_SUBSCRIPTION: StripeSubscription = {
    id: TEST_IDS.subscriptionId,
    stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
    stripeSubscriptionItemId: TEST_IDS.stripeSubscriptionItemId,
    status: "active",
    currentPeriodStart: MOCK_DATES.currentPeriodStart,
    currentPeriodEnd: MOCK_DATES.currentPeriodEnd,
    cancelAtPeriodEnd: false,
    trialStart: MOCK_DATES.trialStart,
    trialEnd: MOCK_DATES.trialEnd,
    quantity: 1,
    createdAt: MOCK_DATES.createdAt,
    updatedAt: MOCK_DATES.updatedAt,
    billingCustomer: {} as any,
    price: {} as any,
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
        StripeSubscriptionRepository,
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
      ],
    }).compile();

    repository = module.get<StripeSubscriptionRepository>(StripeSubscriptionRepository);
    neo4jService = module.get<Neo4jService>(Neo4jService) as vi.Mocked<Neo4jService>;

    // Reset mocks before each test
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
        query: `CREATE CONSTRAINT ${stripeSubscriptionMeta.nodeName}_id IF NOT EXISTS FOR (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName}) REQUIRE ${stripeSubscriptionMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should create unique constraint on stripeSubscriptionId field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${stripeSubscriptionMeta.nodeName}_stripeSubscriptionId IF NOT EXISTS FOR (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName}) REQUIRE ${stripeSubscriptionMeta.nodeName}.stripeSubscriptionId IS UNIQUE`,
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

  describe("findByStripeCustomerId", () => {
    it("should find subscriptions by billing customer ID without status filter", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_SUBSCRIPTION]);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams.stripeCustomerId).toBe(TEST_IDS.stripeCustomerId);
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})`,
      );
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`WHERE 1=1`);
      expect(mockQuery.query).not.toContain(`${stripeSubscriptionMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(
        `RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}`,
      );
      expect(mockQuery.query).toContain(`ORDER BY ${stripeSubscriptionMeta.nodeName}.createdAt DESC`);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_SUBSCRIPTION]);
    });

    it("should find subscriptions by billing customer ID with status filter", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_SUBSCRIPTION]);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        status: "active",
      });

      expect(mockQuery.queryParams).toEqual({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        status: "active",
      });
      expect(mockQuery.query).toContain(`WHERE 1=1 AND ${stripeSubscriptionMeta.nodeName}.status = $status`);
      expect(result).toEqual([MOCK_SUBSCRIPTION]);
    });

    it("should return empty array when no subscriptions found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(result).toEqual([]);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });

    it("should filter by specific status values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_SUBSCRIPTION]);

      const statuses: StripeSubscriptionStatus[] = ["active", "trialing", "past_due", "canceled"];

      for (const status of statuses) {
        vi.clearAllMocks();
        neo4jService.initQuery.mockReturnValue(createMockQuery());

        await repository.findByStripeCustomerId({
          stripeCustomerId: TEST_IDS.stripeCustomerId,
          status,
        });

        expect(neo4jService.initQuery().queryParams.status).toBe(status);
      }
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database error");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId })).rejects.toThrow(
        "Database error",
      );
    });

    it("should order results by createdAt DESC", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_SUBSCRIPTION]);

      await repository.findByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(mockQuery.query).toContain(`ORDER BY ${stripeSubscriptionMeta.nodeName}.createdAt DESC`);
    });
  });

  describe("findById", () => {
    it("should find subscription by ID with relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await repository.findById({ id: TEST_IDS.subscriptionId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.subscriptionId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripeCustomerMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}`,
      );
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should return null when subscription not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ id: "nonexistent-id" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Read operation failed");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findById({ id: TEST_IDS.subscriptionId })).rejects.toThrow("Read operation failed");
    });
  });

  describe("findByStripeSubscriptionId", () => {
    it("should find subscription by Stripe subscription ID with relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await repository.findByStripeSubscriptionId({
        stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {stripeSubscriptionId: $stripeSubscriptionId})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripeCustomerMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}`,
      );
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should return null when subscription not found by Stripe ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripeSubscriptionId({ stripeSubscriptionId: "sub_nonexistent" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(
        repository.findByStripeSubscriptionId({ stripeSubscriptionId: TEST_IDS.stripeSubscriptionId }),
      ).rejects.toThrow("Database connection error");
    });

    it("should preserve exact Stripe subscription ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const exactStripeId = "sub_1MvN8z3FkJ0LJ6p";

      await repository.findByStripeSubscriptionId({ stripeSubscriptionId: exactStripeId });

      expect(mockQuery.queryParams.stripeSubscriptionId).toBe(exactStripeId);
    });
  });

  describe("create", () => {
    const validCreateParams = {
      stripeCustomerId: TEST_IDS.stripeCustomerId,
      priceId: TEST_IDS.priceId,
      stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
      status: "active" as StripeSubscriptionStatus,
      currentPeriodStart: MOCK_DATES.currentPeriodStart,
      currentPeriodEnd: MOCK_DATES.currentPeriodEnd,
      cancelAtPeriodEnd: false,
      quantity: 1,
    };

    it("should create subscription with required fields only", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await repository.create(validCreateParams);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toMatchObject({
        stripeCustomerId: validCreateParams.stripeCustomerId,
        priceId: validCreateParams.priceId,
        stripeSubscriptionId: validCreateParams.stripeSubscriptionId,
        status: validCreateParams.status,
        currentPeriodStart: MOCK_DATES.currentPeriodStart.toISOString(),
        currentPeriodEnd: MOCK_DATES.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: false,
        stripeSubscriptionItemId: null,
        trialStart: null,
        trialEnd: null,
        quantity: 1,
      });
      expect(mockQuery.queryParams.id).toBeDefined();
      expect(mockQuery.query).toContain(
        `MATCH (${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {id: $stripeCustomerId})`,
      );
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $priceId})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `CREATE (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName}`,
      );
      expect(mockQuery.query).toContain("createdAt: datetime()");
      expect(mockQuery.query).toContain("updatedAt: datetime()");
      expect(mockQuery.query).toContain(
        `CREATE (${stripeSubscriptionMeta.nodeName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName})`,
      );
      expect(mockQuery.query).toContain(
        `CREATE (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName})`,
      );
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should create subscription with optional stripeSubscriptionItemId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const paramsWithItemId = {
        ...validCreateParams,
        stripeSubscriptionItemId: TEST_IDS.stripeSubscriptionItemId,
      };

      await repository.create(paramsWithItemId);

      expect(mockQuery.queryParams.stripeSubscriptionItemId).toBe(TEST_IDS.stripeSubscriptionItemId);
    });

    it("should create subscription with optional trial dates", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const paramsWithTrial = {
        ...validCreateParams,
        trialStart: MOCK_DATES.trialStart,
        trialEnd: MOCK_DATES.trialEnd,
      };

      await repository.create(paramsWithTrial);

      expect(mockQuery.queryParams.trialStart).toBe(MOCK_DATES.trialStart.toISOString());
      expect(mockQuery.queryParams.trialEnd).toBe(MOCK_DATES.trialEnd.toISOString());
    });

    it("should convert Date objects to ISO strings for Neo4j datetime", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.currentPeriodStart).toBe(MOCK_DATES.currentPeriodStart.toISOString());
      expect(mockQuery.queryParams.currentPeriodEnd).toBe(MOCK_DATES.currentPeriodEnd.toISOString());
      expect(mockQuery.query).toContain("currentPeriodStart: datetime($currentPeriodStart)");
      expect(mockQuery.query).toContain("currentPeriodEnd: datetime($currentPeriodEnd)");
    });

    it("should handle CASE WHEN for nullable trial dates", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.create(validCreateParams);

      expect(mockQuery.query).toContain(
        "trialStart: CASE WHEN $trialStart IS NOT NULL THEN datetime($trialStart) ELSE null END",
      );
      expect(mockQuery.query).toContain(
        "trialEnd: CASE WHEN $trialEnd IS NOT NULL THEN datetime($trialEnd) ELSE null END",
      );
    });

    it("should generate unique UUID for each subscription", async () => {
      const mockQuery1 = createMockQuery();
      const mockQuery2 = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(mockQuery1).mockReturnValueOnce(mockQuery2);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.create(validCreateParams);
      await repository.create(validCreateParams);

      expect(mockQuery1.queryParams.id).toBeDefined();
      expect(mockQuery2.queryParams.id).toBeDefined();
      expect(mockQuery1.queryParams.id).not.toEqual(mockQuery2.queryParams.id);
    });

    it("should handle creation errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Creation failed - billing customer not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.create(validCreateParams)).rejects.toThrow(
        "Creation failed - billing customer not found",
      );
    });

    it("should set null for optional fields when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.stripeSubscriptionItemId).toBeNull();
      expect(mockQuery.queryParams.trialStart).toBeNull();
      expect(mockQuery.queryParams.trialEnd).toBeNull();
    });

    it("should create subscription with all optional fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const fullParams = {
        ...validCreateParams,
        stripeSubscriptionItemId: TEST_IDS.stripeSubscriptionItemId,
        trialStart: MOCK_DATES.trialStart,
        trialEnd: MOCK_DATES.trialEnd,
      };

      await repository.create(fullParams);

      expect(mockQuery.queryParams).toMatchObject({
        stripeSubscriptionItemId: TEST_IDS.stripeSubscriptionItemId,
        trialStart: MOCK_DATES.trialStart.toISOString(),
        trialEnd: MOCK_DATES.trialEnd.toISOString(),
      });
    });
  });

  describe("update", () => {
    it("should update status field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        status: "canceled" as StripeSubscriptionStatus,
      };

      const result = await repository.update(params);

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.subscriptionId);
      expect(mockQuery.queryParams.status).toBe("canceled");
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.status = $status`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should update currentPeriodStart field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const newDate = new Date("2025-02-01T00:00:00Z");
      const params = {
        id: TEST_IDS.subscriptionId,
        currentPeriodStart: newDate,
      };

      await repository.update(params);

      expect(mockQuery.queryParams.currentPeriodStart).toBe(newDate.toISOString());
      expect(mockQuery.query).toContain(
        `${stripeSubscriptionMeta.nodeName}.currentPeriodStart = datetime($currentPeriodStart)`,
      );
    });

    it("should update currentPeriodEnd field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const newDate = new Date("2025-03-01T00:00:00Z");
      const params = {
        id: TEST_IDS.subscriptionId,
        currentPeriodEnd: newDate,
      };

      await repository.update(params);

      expect(mockQuery.queryParams.currentPeriodEnd).toBe(newDate.toISOString());
      expect(mockQuery.query).toContain(
        `${stripeSubscriptionMeta.nodeName}.currentPeriodEnd = datetime($currentPeriodEnd)`,
      );
    });

    it("should update cancelAtPeriodEnd field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        cancelAtPeriodEnd: true,
      };

      await repository.update(params);

      expect(mockQuery.queryParams.cancelAtPeriodEnd).toBe(true);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.cancelAtPeriodEnd = $cancelAtPeriodEnd`);
    });

    it("should update canceledAt field with Date value", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        canceledAt: MOCK_DATES.canceledAt,
      };

      await repository.update(params);

      expect(mockQuery.queryParams.canceledAt).toBe(MOCK_DATES.canceledAt.toISOString());
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.canceledAt = datetime($canceledAt)`);
      expect(mockQuery.query).not.toContain(`${stripeSubscriptionMeta.nodeName}.canceledAt = null`);
    });

    it("should update canceledAt field with null value", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        canceledAt: null,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.canceledAt = null`);
      expect(mockQuery.query).not.toContain(`datetime($canceledAt)`);
    });

    it("should update trialStart field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        trialStart: MOCK_DATES.trialStart,
      };

      await repository.update(params);

      expect(mockQuery.queryParams.trialStart).toBe(MOCK_DATES.trialStart.toISOString());
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.trialStart = datetime($trialStart)`);
    });

    it("should update trialEnd field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        trialEnd: MOCK_DATES.trialEnd,
      };

      await repository.update(params);

      expect(mockQuery.queryParams.trialEnd).toBe(MOCK_DATES.trialEnd.toISOString());
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.trialEnd = datetime($trialEnd)`);
    });

    it("should update pausedAt field with Date value", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        pausedAt: MOCK_DATES.pausedAt,
      };

      await repository.update(params);

      expect(mockQuery.queryParams.pausedAt).toBe(MOCK_DATES.pausedAt.toISOString());
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.pausedAt = datetime($pausedAt)`);
      expect(mockQuery.query).not.toContain(`${stripeSubscriptionMeta.nodeName}.pausedAt = null`);
    });

    it("should update pausedAt field with null value", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        pausedAt: null,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.pausedAt = null`);
      expect(mockQuery.query).not.toContain(`datetime($pausedAt)`);
    });

    it("should update quantity field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        quantity: 5,
      };

      await repository.update(params);

      expect(mockQuery.queryParams.quantity).toBe(5);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.quantity = $quantity`);
    });

    it("should update multiple fields at once", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        status: "canceled" as StripeSubscriptionStatus,
        cancelAtPeriodEnd: true,
        canceledAt: MOCK_DATES.canceledAt,
        quantity: 2,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.status = $status`);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.cancelAtPeriodEnd = $cancelAtPeriodEnd`);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.canceledAt = datetime($canceledAt)`);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.quantity = $quantity`);
      expect(mockQuery.queryParams).toMatchObject({
        status: "canceled",
        cancelAtPeriodEnd: true,
        canceledAt: MOCK_DATES.canceledAt.toISOString(),
        quantity: 2,
      });
    });

    it("should only update updatedAt when no optional fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).not.toContain(`${stripeSubscriptionMeta.nodeName}.status = $status`);
      expect(mockQuery.query).not.toContain(`${stripeSubscriptionMeta.nodeName}.quantity = $quantity`);
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.update({ id: TEST_IDS.subscriptionId, status: "active" });

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should include relationships in MATCH and RETURN clauses", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.update({ id: TEST_IDS.subscriptionId, status: "active" });

      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}`,
      );
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - subscription not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.update({ id: TEST_IDS.subscriptionId, status: "active" })).rejects.toThrow(
        "Update failed - subscription not found",
      );
    });

    it("should handle quantity as zero", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.update({ id: TEST_IDS.subscriptionId, quantity: 0 });

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.quantity = $quantity`);
      expect(mockQuery.queryParams.quantity).toBe(0);
    });

    it("should handle cancelAtPeriodEnd as false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.update({ id: TEST_IDS.subscriptionId, cancelAtPeriodEnd: false });

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.cancelAtPeriodEnd = $cancelAtPeriodEnd`);
      expect(mockQuery.queryParams.cancelAtPeriodEnd).toBe(false);
    });
  });

  describe("updateByStripeSubscriptionId", () => {
    it("should find subscription and delegate to update method", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValueOnce(MOCK_SUBSCRIPTION);
      neo4jService.writeOne.mockResolvedValue({ ...MOCK_SUBSCRIPTION, status: "canceled" });

      const params = {
        stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
        status: "canceled" as StripeSubscriptionStatus,
      };

      const result = await repository.updateByStripeSubscriptionId(params);

      // First call should be findByStripeSubscriptionId
      expect(neo4jService.readOne).toHaveBeenCalled();
      // Second call should be update
      expect(neo4jService.writeOne).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.status).toBe("canceled");
    });

    it("should return null when subscription not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.updateByStripeSubscriptionId({
        stripeSubscriptionId: "sub_nonexistent",
        status: "canceled",
      });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalled();
      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });

    it("should pass all update parameters to update method", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
        status: "canceled" as StripeSubscriptionStatus,
        cancelAtPeriodEnd: true,
        canceledAt: MOCK_DATES.canceledAt,
        quantity: 3,
      };

      await repository.updateByStripeSubscriptionId(params);

      // The last writeOne call should have the update query
      const lastWriteCall = neo4jService.writeOne.mock.calls[neo4jService.writeOne.mock.calls.length - 1];
      const updateQuery = lastWriteCall[0];

      expect(updateQuery.queryParams).toMatchObject({
        id: MOCK_SUBSCRIPTION.id,
        status: "canceled",
        cancelAtPeriodEnd: true,
        canceledAt: MOCK_DATES.canceledAt.toISOString(),
        quantity: 3,
      });
    });

    it("should handle update errors after finding subscription", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);
      const error = new Error("Update failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updateByStripeSubscriptionId({
          stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
          status: "canceled",
        }),
      ).rejects.toThrow("Update failed");
    });

    it("should update with only stripeSubscriptionId when no other fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.updateByStripeSubscriptionId({
        stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
      });

      expect(neo4jService.readOne).toHaveBeenCalled();
      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("updatePrice", () => {
    it("should delete old USES_PRICE relationship and create new one", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        id: TEST_IDS.subscriptionId,
        newPriceId: "new-price-id",
      };

      const result = await repository.updatePrice(params);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.subscriptionId,
        newPriceId: "new-price-id",
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName})-[oldRel:USES_PRICE]->(:${stripePriceMeta.labelName})`,
      );
      expect(mockQuery.query).toContain("DELETE oldRel");
      expect(mockQuery.query).toContain(`WITH ${stripeSubscriptionMeta.nodeName}, ${stripeCustomerMeta.nodeName}`);
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $newPriceId})-[:BELONGS_TO]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(
        `CREATE (${stripeSubscriptionMeta.nodeName})-[:USES_PRICE]->(${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName})`,
      );
      expect(mockQuery.query).toContain(`SET ${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(
        `RETURN ${stripeSubscriptionMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}, ${stripeSubscriptionMeta.nodeName}_${stripePriceMeta.nodeName}_${stripeProductMeta.nodeName}`,
      );
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should update updatedAt timestamp when changing price", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.updatePrice({
        id: TEST_IDS.subscriptionId,
        newPriceId: "new-price-id",
      });

      expect(mockQuery.query).toContain(`SET ${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should handle errors when new price not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Price not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updatePrice({
          id: TEST_IDS.subscriptionId,
          newPriceId: "nonexistent-price",
        }),
      ).rejects.toThrow("Price not found");
    });

    it("should handle errors when subscription not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Subscription not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updatePrice({
          id: "nonexistent-subscription",
          newPriceId: TEST_IDS.priceId,
        }),
      ).rejects.toThrow("Subscription not found");
    });

    it("should use WITH clause to maintain context between operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.updatePrice({
        id: TEST_IDS.subscriptionId,
        newPriceId: "new-price-id",
      });

      expect(mockQuery.query).toContain(`WITH ${stripeSubscriptionMeta.nodeName}, ${stripeCustomerMeta.nodeName}`);
    });
  });

  describe("delete", () => {
    it("should delete subscription using DETACH DELETE", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.subscriptionId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith();
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.subscriptionId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName} {id: $id})`,
      );
      expect(mockQuery.query).toContain(`DETACH DELETE ${stripeSubscriptionMeta.nodeName}`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should not return a value after deletion", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const result = await repository.delete({ id: TEST_IDS.subscriptionId });

      expect(result).toBeUndefined();
    });

    it("should handle deletion errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Deletion failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.delete({ id: TEST_IDS.subscriptionId })).rejects.toThrow("Deletion failed");
    });

    it("should delete subscription with all relationships using DETACH DELETE", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.subscriptionId });

      expect(mockQuery.query).toContain("DETACH DELETE");
    });
  });

  describe("cancelAllByStripeCustomerId", () => {
    it("should cancel all active, trialing, and past_due subscriptions", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue({ count: 3 });

      const result = await repository.cancelAllByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith();
      expect(mockQuery.queryParams.stripeCustomerId).toBe(TEST_IDS.stripeCustomerId);
      expect(mockQuery.queryParams.canceledStatus).toBe("canceled");
      expect(mockQuery.queryParams.canceledAt).toBeDefined();
      expect(mockQuery.query).toContain(
        `MATCH (${stripeSubscriptionMeta.nodeName}:${stripeSubscriptionMeta.labelName})-[:BELONGS_TO]->(${stripeCustomerMeta.nodeName}:${stripeCustomerMeta.labelName} {stripeCustomerId: $stripeCustomerId})`,
      );
      expect(mockQuery.query).toContain(
        `WHERE ${stripeSubscriptionMeta.nodeName}.status IN ['active', 'trialing', 'past_due']`,
      );
      expect(mockQuery.query).toContain(`SET ${stripeSubscriptionMeta.nodeName}.status = $canceledStatus`);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.canceledAt = datetime($canceledAt)`);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.cancelAtPeriodEnd = false`);
      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`RETURN count(${stripeSubscriptionMeta.nodeName}) as count`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toBe(3);
    });

    it("should return 0 when no subscriptions found to cancel", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue({ count: 0 });

      const result = await repository.cancelAllByStripeCustomerId({
        stripeCustomerId: "cus_no_subscriptions",
      });

      expect(result).toBe(0);
    });

    it("should return 0 when result is null", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(null);

      const result = await repository.cancelAllByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(result).toBe(0);
    });

    it("should set cancelAtPeriodEnd to false for all canceled subscriptions", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue({ count: 2 });

      await repository.cancelAllByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.cancelAtPeriodEnd = false`);
    });

    it("should update canceledAt with current datetime", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue({ count: 1 });

      const beforeTime = new Date();
      await repository.cancelAllByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });
      const afterTime = new Date();

      expect(mockQuery.queryParams.canceledAt).toBeDefined();
      const canceledAtTime = new Date(mockQuery.queryParams.canceledAt);
      expect(canceledAtTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(canceledAtTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it("should update updatedAt timestamp for all canceled subscriptions", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue({ count: 5 });

      await repository.cancelAllByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(mockQuery.query).toContain(`${stripeSubscriptionMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should only cancel subscriptions with specific statuses", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue({ count: 2 });

      await repository.cancelAllByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(mockQuery.query).toContain("WHERE");
      expect(mockQuery.query).toContain("IN ['active', 'trialing', 'past_due']");
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Bulk update failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.cancelAllByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId }),
      ).rejects.toThrow("Bulk update failed");
    });

    it("should return count as number from database result", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue({ count: 7 });

      const result = await repository.cancelAllByStripeCustomerId({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      expect(typeof result).toBe("number");
      expect(result).toBe(7);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string values in Stripe IDs", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        priceId: TEST_IDS.priceId,
        stripeSubscriptionId: "",
        status: "active" as StripeSubscriptionStatus,
        currentPeriodStart: MOCK_DATES.currentPeriodStart,
        currentPeriodEnd: MOCK_DATES.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        quantity: 1,
      };

      await repository.create(params);

      expect(mockQuery.queryParams.stripeSubscriptionId).toBe("");
    });

    it("should handle very large quantity values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.update({
        id: TEST_IDS.subscriptionId,
        quantity: 999999,
      });

      expect(mockQuery.queryParams.quantity).toBe(999999);
    });

    it("should handle negative quantity values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.update({
        id: TEST_IDS.subscriptionId,
        quantity: -1,
      });

      expect(mockQuery.queryParams.quantity).toBe(-1);
    });

    it("should handle future dates for trial and period dates", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const futureDate = new Date("2099-12-31T23:59:59Z");

      await repository.update({
        id: TEST_IDS.subscriptionId,
        currentPeriodEnd: futureDate,
        trialEnd: futureDate,
      });

      expect(mockQuery.queryParams.currentPeriodEnd).toBe(futureDate.toISOString());
      expect(mockQuery.queryParams.trialEnd).toBe(futureDate.toISOString());
    });

    it("should handle past dates for canceledAt and pausedAt", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const pastDate = new Date("2000-01-01T00:00:00Z");

      await repository.update({
        id: TEST_IDS.subscriptionId,
        canceledAt: pastDate,
        pausedAt: pastDate,
      });

      expect(mockQuery.queryParams.canceledAt).toBe(pastDate.toISOString());
      expect(mockQuery.queryParams.pausedAt).toBe(pastDate.toISOString());
    });

    it("should handle all possible subscription statuses", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const statuses: StripeSubscriptionStatus[] = [
        "active",
        "past_due",
        "unpaid",
        "canceled",
        "incomplete",
        "incomplete_expired",
        "trialing",
        "paused",
      ];

      for (const status of statuses) {
        vi.clearAllMocks();
        neo4jService.initQuery.mockReturnValue(createMockQuery());

        await repository.update({
          id: TEST_IDS.subscriptionId,
          status,
        });

        expect(neo4jService.initQuery().queryParams.status).toBe(status);
      }
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";

      await repository.findById({ id: exactId });

      expect(mockQuery.queryParams.id).toBe(exactId);
    });

    it("should preserve exact Stripe subscription ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const exactStripeId = "sub_1MvN8z3FkJ0LJ6p";

      await repository.findByStripeSubscriptionId({ stripeSubscriptionId: exactStripeId });

      expect(mockQuery.queryParams.stripeSubscriptionId).toBe(exactStripeId);
    });

    it("should preserve exact datetime values after ISO conversion", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      const exactDate = new Date("2025-06-15T14:30:00.000Z");

      await repository.update({
        id: TEST_IDS.subscriptionId,
        currentPeriodStart: exactDate,
      });

      expect(mockQuery.queryParams.currentPeriodStart).toBe("2025-06-15T14:30:00.000Z");
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery with serialiser for read operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);
      neo4jService.readMany.mockResolvedValue([MOCK_SUBSCRIPTION]);

      await repository.findById({ id: TEST_IDS.subscriptionId });
      await repository.findByStripeSubscriptionId({ stripeSubscriptionId: TEST_IDS.stripeSubscriptionId });
      await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId });

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(3);
      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: expect.anything() });
    });

    it("should call Neo4jService.writeOne for create, update, and delete operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.create({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
        priceId: TEST_IDS.priceId,
        stripeSubscriptionId: TEST_IDS.stripeSubscriptionId,
        status: "active",
        currentPeriodStart: MOCK_DATES.currentPeriodStart,
        currentPeriodEnd: MOCK_DATES.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        quantity: 1,
      });

      await repository.update({ id: TEST_IDS.subscriptionId, status: "canceled" });
      await repository.updatePrice({ id: TEST_IDS.subscriptionId, newPriceId: "new-price" });

      neo4jService.writeOne.mockResolvedValue(undefined);
      await repository.delete({ id: TEST_IDS.subscriptionId });

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(4);
    });

    it("should use readMany for findByStripeCustomerId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_SUBSCRIPTION]);

      await repository.findByStripeCustomerId({ stripeCustomerId: TEST_IDS.stripeCustomerId });

      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });

    it("should use readOne for findById and findByStripeSubscriptionId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_SUBSCRIPTION);

      await repository.findById({ id: TEST_IDS.subscriptionId });
      await repository.findByStripeSubscriptionId({ stripeSubscriptionId: TEST_IDS.stripeSubscriptionId });

      expect(neo4jService.readOne).toHaveBeenCalledTimes(2);
    });
  });
});
