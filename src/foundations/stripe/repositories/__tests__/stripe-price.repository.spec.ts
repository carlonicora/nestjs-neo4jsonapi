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
import { StripePriceRepository } from "../stripe-price.repository";
import { stripePriceMeta } from "../../entities/stripe-price.meta";
import { stripeProductMeta } from "../../entities/stripe-product.meta";
import {
  StripePrice,
  StripePriceType,
  StripePriceRecurringInterval,
  StripePriceRecurringUsageType,
} from "../../entities/stripe-price.entity";

describe("StripePriceRepository", () => {
  let repository: StripePriceRepository;
  let neo4jService: jest.Mocked<Neo4jService>;

  // Test data constants
  const TEST_IDS = {
    priceId: "550e8400-e29b-41d4-a716-446655440000",
    productId: "660e8400-e29b-41d4-a716-446655440001",
    stripePriceId: "price_test123",
  };

  const MOCK_STRIPE_PRICE_ONE_TIME: StripePrice = {
    id: TEST_IDS.priceId,
    stripePriceId: TEST_IDS.stripePriceId,
    active: true,
    currency: "usd",
    unitAmount: 1999,
    priceType: "one_time",
    recurringInterval: undefined,
    recurringIntervalCount: undefined,
    recurringUsageType: undefined,
    nickname: "One-time price",
    lookupKey: "one_time_test",
    metadata: JSON.stringify({ test: "data" }),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    product: {} as any,
  };

  const MOCK_STRIPE_PRICE_RECURRING: StripePrice = {
    id: TEST_IDS.priceId,
    stripePriceId: "price_recurring_test",
    active: true,
    currency: "usd",
    unitAmount: 2999,
    priceType: "recurring",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    recurringUsageType: "licensed",
    nickname: "Monthly subscription",
    lookupKey: "monthly_sub",
    metadata: JSON.stringify({ tier: "premium" }),
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    product: {} as any,
  };

  const MOCK_STRIPE_PRICE_METERED: StripePrice = {
    id: TEST_IDS.priceId,
    stripePriceId: "price_metered_test",
    active: true,
    currency: "usd",
    unitAmount: undefined,
    priceType: "recurring",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    recurringUsageType: "metered",
    nickname: "Pay-as-you-go",
    lookupKey: undefined,
    metadata: undefined,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    product: {} as any,
  };

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StripePriceRepository, Neo4jService],
    }).compile();

    repository = module.get<StripePriceRepository>(StripePriceRepository);
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
        query: `CREATE CONSTRAINT ${stripePriceMeta.nodeName}_id IF NOT EXISTS FOR (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName}) REQUIRE ${stripePriceMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should create unique constraint on stripePriceId field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${stripePriceMeta.nodeName}_stripePriceId IF NOT EXISTS FOR (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName}) REQUIRE ${stripePriceMeta.nodeName}.stripePriceId IS UNIQUE`,
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

  describe("findAll", () => {
    it("should find all prices without filters", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRICE_ONE_TIME, MOCK_STRIPE_PRICE_RECURRING]);

      const result = await repository.findAll();

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.query).toContain(`MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})`);
      expect(mockQuery.query).toContain(
        `-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripePriceMeta.nodeName}.createdAt DESC`);
      expect(mockQuery.query).not.toContain("WHERE");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toHaveLength(2);
    });

    it("should find all prices filtered by productId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRICE_ONE_TIME]);

      const result = await repository.findAll({ productId: TEST_IDS.productId });

      expect(mockQuery.queryParams).toEqual({
        productId: TEST_IDS.productId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $productId})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripePriceMeta.nodeName}.createdAt DESC`);
      expect(mockQuery.query).not.toContain("WHERE");
      expect(result).toEqual([MOCK_STRIPE_PRICE_ONE_TIME]);
    });

    it("should find all prices filtered by active=true", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRICE_ONE_TIME]);

      const result = await repository.findAll({ active: true });

      expect(mockQuery.queryParams).toEqual({
        active: true,
      });
      expect(mockQuery.query).toContain(`WHERE ${stripePriceMeta.nodeName}.active = $active`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripePriceMeta.nodeName}.createdAt DESC`);
      expect(result).toEqual([MOCK_STRIPE_PRICE_ONE_TIME]);
    });

    it("should find all prices filtered by active=false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findAll({ active: false });

      expect(mockQuery.queryParams).toEqual({
        active: false,
      });
      expect(mockQuery.query).toContain(`WHERE ${stripePriceMeta.nodeName}.active = $active`);
      expect(result).toEqual([]);
    });

    it("should find all prices filtered by both productId and active", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRICE_ONE_TIME]);

      const result = await repository.findAll({
        productId: TEST_IDS.productId,
        active: true,
      });

      expect(mockQuery.queryParams).toEqual({
        productId: TEST_IDS.productId,
        active: true,
      });
      expect(mockQuery.query).toContain(
        `${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $productId}`,
      );
      expect(mockQuery.query).toContain(`WHERE ${stripePriceMeta.nodeName}.active = $active`);
      expect(mockQuery.query).toContain(`ORDER BY ${stripePriceMeta.nodeName}.createdAt DESC`);
      expect(result).toEqual([MOCK_STRIPE_PRICE_ONE_TIME]);
    });

    it("should return empty array when no prices found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findAll();

      expect(result).toEqual([]);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database error");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findAll()).rejects.toThrow("Database error");
    });
  });

  describe("findById", () => {
    it("should find price by ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const result = await repository.findById({ id: TEST_IDS.priceId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.priceId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_STRIPE_PRICE_ONE_TIME);
    });

    it("should return null when price not found by ID", async () => {
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

      await expect(repository.findById({ id: TEST_IDS.priceId })).rejects.toThrow("Read operation failed");
    });
  });

  describe("findByStripePriceId", () => {
    it("should find price by Stripe price ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const result = await repository.findByStripePriceId({ stripePriceId: TEST_IDS.stripePriceId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        stripePriceId: TEST_IDS.stripePriceId,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {stripePriceId: $stripePriceId})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${stripePriceMeta.nodeName}, ${stripeProductMeta.nodeName}`);
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_STRIPE_PRICE_ONE_TIME);
    });

    it("should return null when price not found by Stripe price ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripePriceId({ stripePriceId: "price_nonexistent" });

      expect(result).toBeNull();
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findByStripePriceId({ stripePriceId: TEST_IDS.stripePriceId })).rejects.toThrow(
        "Database connection error",
      );
    });
  });

  describe("create", () => {
    describe("one-time prices", () => {
      const validOneTimeParams = {
        productId: TEST_IDS.productId,
        stripePriceId: "price_one_time_new",
        active: true,
        currency: "usd",
        unitAmount: 1999,
        priceType: "one_time" as StripePriceType,
      };

      it("should create one-time price with required fields only", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        const result = await repository.create(validOneTimeParams);

        expect(neo4jService.initQuery).toHaveBeenCalledWith({
          serialiser: expect.anything(),
        });
        expect(mockQuery.queryParams).toMatchObject({
          productId: validOneTimeParams.productId,
          stripePriceId: validOneTimeParams.stripePriceId,
          active: validOneTimeParams.active,
          currency: validOneTimeParams.currency,
          unitAmount: validOneTimeParams.unitAmount,
          priceType: validOneTimeParams.priceType,
          recurringInterval: null,
          recurringIntervalCount: null,
          recurringUsageType: null,
          nickname: null,
          lookupKey: null,
          metadata: null,
        });
        expect(mockQuery.queryParams.id).toBeDefined();
        expect(mockQuery.query).toContain(
          `MATCH (${stripeProductMeta.nodeName}:${stripeProductMeta.labelName} {id: $productId})`,
        );
        expect(mockQuery.query).toContain(`CREATE (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName}`);
        expect(mockQuery.query).toContain("createdAt: datetime()");
        expect(mockQuery.query).toContain("updatedAt: datetime()");
        expect(mockQuery.query).toContain(
          `CREATE (${stripePriceMeta.nodeName})-[:BELONGS_TO]->(${stripeProductMeta.nodeName})`,
        );
        expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
        expect(result).toEqual(MOCK_STRIPE_PRICE_ONE_TIME);
      });

      it("should create one-time price with all optional fields", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        const paramsWithOptionals = {
          ...validOneTimeParams,
          nickname: "Premium package",
          lookupKey: "premium_pkg",
          metadata: JSON.stringify({ tier: "premium" }),
        };

        await repository.create(paramsWithOptionals);

        expect(mockQuery.queryParams).toMatchObject({
          nickname: "Premium package",
          lookupKey: "premium_pkg",
          metadata: JSON.stringify({ tier: "premium" }),
        });
        expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      });
    });

    describe("recurring prices", () => {
      const validRecurringParams = {
        productId: TEST_IDS.productId,
        stripePriceId: "price_recurring_new",
        active: true,
        currency: "usd",
        unitAmount: 2999,
        priceType: "recurring" as StripePriceType,
        recurringInterval: "month" as StripePriceRecurringInterval,
        recurringIntervalCount: 1,
        recurringUsageType: "licensed" as StripePriceRecurringUsageType,
      };

      it("should create monthly recurring price", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_RECURRING);

        const result = await repository.create(validRecurringParams);

        expect(mockQuery.queryParams).toMatchObject({
          priceType: "recurring",
          recurringInterval: "month",
          recurringIntervalCount: 1,
          recurringUsageType: "licensed",
        });
        expect(result).toEqual(MOCK_STRIPE_PRICE_RECURRING);
      });

      it("should create daily recurring price", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_RECURRING);

        const dailyParams = {
          ...validRecurringParams,
          recurringInterval: "day" as StripePriceRecurringInterval,
        };

        await repository.create(dailyParams);

        expect(mockQuery.queryParams.recurringInterval).toBe("day");
      });

      it("should create weekly recurring price", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_RECURRING);

        const weeklyParams = {
          ...validRecurringParams,
          recurringInterval: "week" as StripePriceRecurringInterval,
        };

        await repository.create(weeklyParams);

        expect(mockQuery.queryParams.recurringInterval).toBe("week");
      });

      it("should create yearly recurring price", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_RECURRING);

        const yearlyParams = {
          ...validRecurringParams,
          recurringInterval: "year" as StripePriceRecurringInterval,
        };

        await repository.create(yearlyParams);

        expect(mockQuery.queryParams.recurringInterval).toBe("year");
      });

      it("should create recurring price with custom interval count", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_RECURRING);

        const customIntervalParams = {
          ...validRecurringParams,
          recurringIntervalCount: 3,
        };

        await repository.create(customIntervalParams);

        expect(mockQuery.queryParams.recurringIntervalCount).toBe(3);
      });

      it("should create metered usage recurring price", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_METERED);

        const meteredParams = {
          ...validRecurringParams,
          unitAmount: undefined,
          recurringUsageType: "metered" as StripePriceRecurringUsageType,
        };

        await repository.create(meteredParams);

        expect(mockQuery.queryParams).toMatchObject({
          unitAmount: null,
          recurringUsageType: "metered",
        });
      });

      it("should create licensed usage recurring price", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_RECURRING);

        await repository.create(validRecurringParams);

        expect(mockQuery.queryParams.recurringUsageType).toBe("licensed");
      });
    });

    describe("field handling", () => {
      const baseParams = {
        productId: TEST_IDS.productId,
        stripePriceId: "price_field_test",
        active: true,
        currency: "usd",
        unitAmount: 1000,
        priceType: "one_time" as StripePriceType,
      };

      it("should set unitAmount to null when undefined for metered pricing", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_METERED);

        const meteredParams = {
          ...baseParams,
          unitAmount: undefined,
          priceType: "recurring" as StripePriceType,
          recurringInterval: "month" as StripePriceRecurringInterval,
          recurringUsageType: "metered" as StripePriceRecurringUsageType,
        };

        await repository.create(meteredParams);

        expect(mockQuery.queryParams.unitAmount).toBeNull();
      });

      it("should set recurringInterval to null when not provided", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        await repository.create(baseParams);

        expect(mockQuery.queryParams.recurringInterval).toBeNull();
      });

      it("should set recurringIntervalCount to null when not provided", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        await repository.create(baseParams);

        expect(mockQuery.queryParams.recurringIntervalCount).toBeNull();
      });

      it("should set recurringUsageType to null when not provided", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        await repository.create(baseParams);

        expect(mockQuery.queryParams.recurringUsageType).toBeNull();
      });

      it("should set nickname to null when not provided", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        await repository.create(baseParams);

        expect(mockQuery.queryParams.nickname).toBeNull();
      });

      it("should set lookupKey to null when not provided", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        await repository.create(baseParams);

        expect(mockQuery.queryParams.lookupKey).toBeNull();
      });

      it("should set metadata to null when not provided", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        await repository.create(baseParams);

        expect(mockQuery.queryParams.metadata).toBeNull();
      });

      it("should create price with active=false", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        const inactiveParams = {
          ...baseParams,
          active: false,
        };

        await repository.create(inactiveParams);

        expect(mockQuery.queryParams.active).toBe(false);
      });

      it("should handle different currency codes", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        const eurParams = {
          ...baseParams,
          currency: "eur",
        };

        await repository.create(eurParams);

        expect(mockQuery.queryParams.currency).toBe("eur");
      });
    });

    describe("validation and errors", () => {
      const baseParams = {
        productId: TEST_IDS.productId,
        stripePriceId: "price_error_test",
        active: true,
        currency: "usd",
        unitAmount: 1000,
        priceType: "one_time" as StripePriceType,
      };

      it("should generate unique UUID for each price", async () => {
        const mockQuery1 = createMockQuery();
        const mockQuery2 = createMockQuery();
        neo4jService.initQuery.mockReturnValueOnce(mockQuery1).mockReturnValueOnce(mockQuery2);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        await repository.create(baseParams);
        await repository.create(baseParams);

        expect(mockQuery1.queryParams.id).toBeDefined();
        expect(mockQuery2.queryParams.id).toBeDefined();
        expect(mockQuery1.queryParams.id).not.toEqual(mockQuery2.queryParams.id);
      });

      it("should handle creation errors", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        const error = new Error("Creation failed - product not found");
        neo4jService.writeOne.mockRejectedValue(error);

        await expect(repository.create(baseParams)).rejects.toThrow("Creation failed - product not found");
      });

      it("should preserve exact parameter values", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

        const exactParams = {
          productId: "exact_product_123",
          stripePriceId: "price_exact_456",
          active: true,
          currency: "gbp",
          unitAmount: 5999,
          priceType: "one_time" as StripePriceType,
          nickname: "Exact Test Price",
          lookupKey: "exact_lookup",
          metadata: JSON.stringify({ exact: "metadata" }),
        };

        await repository.create(exactParams);

        expect(mockQuery.queryParams).toMatchObject({
          productId: "exact_product_123",
          stripePriceId: "price_exact_456",
          active: true,
          currency: "gbp",
          unitAmount: 5999,
          priceType: "one_time",
          nickname: "Exact Test Price",
          lookupKey: "exact_lookup",
          metadata: JSON.stringify({ exact: "metadata" }),
        });
      });
    });
  });

  describe("update", () => {
    it("should update active field to true", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        id: TEST_IDS.priceId,
        active: true,
      };

      const result = await repository.update(params);

      expect(mockQuery.queryParams).toEqual({
        id: TEST_IDS.priceId,
        active: true,
        nickname: undefined,
        metadata: undefined,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {id: $id})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.active = $active`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_STRIPE_PRICE_ONE_TIME);
    });

    it("should update active field to false", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        id: TEST_IDS.priceId,
        active: false,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.active = $active`);
      expect(mockQuery.queryParams.active).toBe(false);
    });

    it("should update nickname field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        id: TEST_IDS.priceId,
        nickname: "Updated nickname",
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.nickname = $nickname`);
      expect(mockQuery.queryParams.nickname).toBe("Updated nickname");
    });

    it("should update metadata field", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        id: TEST_IDS.priceId,
        metadata: JSON.stringify({ updated: "metadata" }),
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.metadata = $metadata`);
      expect(mockQuery.queryParams.metadata).toBe(JSON.stringify({ updated: "metadata" }));
    });

    it("should update multiple fields at once", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        id: TEST_IDS.priceId,
        active: false,
        nickname: "Multi update",
        metadata: JSON.stringify({ multi: "update" }),
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.active = $active`);
      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.nickname = $nickname`);
      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.metadata = $metadata`);
      expect(mockQuery.queryParams).toMatchObject({
        active: false,
        nickname: "Multi update",
        metadata: JSON.stringify({ multi: "update" }),
      });
    });

    it("should only update id when no optional fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        id: TEST_IDS.priceId,
      };

      await repository.update(params);

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).not.toContain(`${stripePriceMeta.nodeName}.active = $active`);
      expect(mockQuery.query).not.toContain(`${stripePriceMeta.nodeName}.nickname = $nickname`);
      expect(mockQuery.query).not.toContain(`${stripePriceMeta.nodeName}.metadata = $metadata`);
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.update({ id: TEST_IDS.priceId, active: true });

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - price not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.update({ id: TEST_IDS.priceId, active: false })).rejects.toThrow(
        "Update failed - price not found",
      );
    });
  });

  describe("updateByStripePriceId", () => {
    it("should update active field to true by Stripe price ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
      };

      const result = await repository.updateByStripePriceId(params);

      expect(mockQuery.queryParams).toEqual({
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        nickname: undefined,
        metadata: undefined,
      });
      expect(mockQuery.query).toContain(
        `MATCH (${stripePriceMeta.nodeName}:${stripePriceMeta.labelName} {stripePriceId: $stripePriceId})-[:BELONGS_TO]->(${stripeProductMeta.nodeName}:${stripeProductMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.active = $active`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_STRIPE_PRICE_ONE_TIME);
    });

    it("should update active field to false by Stripe price ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.updateByStripePriceId({
        stripePriceId: TEST_IDS.stripePriceId,
        active: false,
      });

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.active = $active`);
      expect(mockQuery.queryParams.active).toBe(false);
    });

    it("should update nickname by Stripe price ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.updateByStripePriceId({
        stripePriceId: TEST_IDS.stripePriceId,
        nickname: "Updated via Stripe ID",
      });

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.nickname = $nickname`);
      expect(mockQuery.queryParams.nickname).toBe("Updated via Stripe ID");
    });

    it("should update metadata by Stripe price ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.updateByStripePriceId({
        stripePriceId: TEST_IDS.stripePriceId,
        metadata: JSON.stringify({ stripe: "update" }),
      });

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.metadata = $metadata`);
      expect(mockQuery.queryParams.metadata).toBe(JSON.stringify({ stripe: "update" }));
    });

    it("should update multiple fields at once by Stripe price ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        nickname: "Multi update Stripe",
        metadata: JSON.stringify({ multi: "stripe" }),
      };

      await repository.updateByStripePriceId(params);

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.active = $active`);
      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.nickname = $nickname`);
      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.metadata = $metadata`);
      expect(mockQuery.queryParams).toMatchObject({
        active: true,
        nickname: "Multi update Stripe",
        metadata: JSON.stringify({ multi: "stripe" }),
      });
    });

    it("should only update stripePriceId when no optional fields provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.updateByStripePriceId({
        stripePriceId: TEST_IDS.stripePriceId,
      });

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.updatedAt = datetime()`);
      expect(mockQuery.query).not.toContain(`${stripePriceMeta.nodeName}.active = $active`);
      expect(mockQuery.query).not.toContain(`${stripePriceMeta.nodeName}.nickname = $nickname`);
      expect(mockQuery.query).not.toContain(`${stripePriceMeta.nodeName}.metadata = $metadata`);
    });

    it("should always update updatedAt timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.updateByStripePriceId({
        stripePriceId: TEST_IDS.stripePriceId,
        active: false,
      });

      expect(mockQuery.query).toContain(`${stripePriceMeta.nodeName}.updatedAt = datetime()`);
    });

    it("should handle update errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Update failed - price not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(
        repository.updateByStripePriceId({
          stripePriceId: TEST_IDS.stripePriceId,
          active: true,
        }),
      ).rejects.toThrow("Update failed - price not found");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string values in create for optional fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const params = {
        productId: TEST_IDS.productId,
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        currency: "usd",
        unitAmount: 1000,
        priceType: "one_time" as StripePriceType,
        nickname: "",
        lookupKey: "",
        metadata: "",
      };

      await repository.create(params);

      expect(mockQuery.queryParams.nickname).toBe("");
      expect(mockQuery.queryParams.lookupKey).toBe("");
      expect(mockQuery.queryParams.metadata).toBe("");
    });

    it("should handle special characters in nickname", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.update({
        id: TEST_IDS.priceId,
        nickname: 'Price\'s "Special" & (Complex) Name',
      });

      expect(mockQuery.queryParams.nickname).toBe('Price\'s "Special" & (Complex) Name');
    });

    it("should handle zero unit amount", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.create({
        productId: TEST_IDS.productId,
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        currency: "usd",
        unitAmount: 0,
        priceType: "one_time" as StripePriceType,
      });

      expect(mockQuery.queryParams.unitAmount).toBe(0);
    });

    it("should handle very large unit amounts", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.create({
        productId: TEST_IDS.productId,
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        currency: "usd",
        unitAmount: 999999999,
        priceType: "one_time" as StripePriceType,
      });

      expect(mockQuery.queryParams.unitAmount).toBe(999999999);
    });

    it("should handle complex JSON metadata", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const complexMetadata = JSON.stringify({
        tier: "premium",
        features: ["feature1", "feature2"],
        nested: { key: "value" },
      });

      await repository.update({
        id: TEST_IDS.priceId,
        metadata: complexMetadata,
      });

      expect(mockQuery.queryParams.metadata).toBe(complexMetadata);
    });

    it("should handle null return from findById gracefully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ id: "nonexistent" });

      expect(result).toBeNull();
    });

    it("should handle null return from findByStripePriceId gracefully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripePriceId({ stripePriceId: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";

      await repository.findById({ id: exactId });

      expect(mockQuery.queryParams.id).toBe(exactId);
    });

    it("should preserve exact Stripe price ID format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      const exactStripePriceId = "price_1MvN8z3FkJ0LJ6p";

      await repository.findByStripePriceId({ stripePriceId: exactStripePriceId });

      expect(mockQuery.queryParams.stripePriceId).toBe(exactStripePriceId);
    });

    it("should preserve currency code case sensitivity", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.create({
        productId: TEST_IDS.productId,
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        currency: "EUR",
        unitAmount: 1000,
        priceType: "one_time" as StripePriceType,
      });

      expect(mockQuery.queryParams.currency).toBe("EUR");
    });

    it("should preserve exact enum values for priceType", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.create({
        productId: TEST_IDS.productId,
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        currency: "usd",
        unitAmount: 1000,
        priceType: "one_time" as StripePriceType,
      });

      expect(mockQuery.queryParams.priceType).toBe("one_time");
    });

    it("should preserve exact enum values for recurringInterval", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_RECURRING);

      await repository.create({
        productId: TEST_IDS.productId,
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        currency: "usd",
        unitAmount: 1000,
        priceType: "recurring" as StripePriceType,
        recurringInterval: "month" as StripePriceRecurringInterval,
      });

      expect(mockQuery.queryParams.recurringInterval).toBe("month");
    });

    it("should preserve exact enum values for recurringUsageType", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_RECURRING);

      await repository.create({
        productId: TEST_IDS.productId,
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        currency: "usd",
        unitAmount: 1000,
        priceType: "recurring" as StripePriceType,
        recurringInterval: "month" as StripePriceRecurringInterval,
        recurringUsageType: "licensed" as StripePriceRecurringUsageType,
      });

      expect(mockQuery.queryParams.recurringUsageType).toBe("licensed");
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery before each read operation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRICE_ONE_TIME]);

      await repository.findAll();
      await repository.findById({ id: TEST_IDS.priceId });
      await repository.findByStripePriceId({ stripePriceId: TEST_IDS.stripePriceId });

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(3);
    });

    it("should call Neo4jService.writeOne for create and update operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.create({
        productId: TEST_IDS.productId,
        stripePriceId: TEST_IDS.stripePriceId,
        active: true,
        currency: "usd",
        unitAmount: 1000,
        priceType: "one_time" as StripePriceType,
      });

      await repository.update({ id: TEST_IDS.priceId, active: false });

      await repository.updateByStripePriceId({ stripePriceId: TEST_IDS.stripePriceId, active: true });

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(3);
    });

    it("should call Neo4jService.readMany for findAll operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_STRIPE_PRICE_ONE_TIME]);

      await repository.findAll();
      await repository.findAll({ productId: TEST_IDS.productId });
      await repository.findAll({ active: true });

      expect(neo4jService.readMany).toHaveBeenCalledTimes(3);
    });

    it("should call Neo4jService.readOne for single item retrieval", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_STRIPE_PRICE_ONE_TIME);

      await repository.findById({ id: TEST_IDS.priceId });
      await repository.findByStripePriceId({ stripePriceId: TEST_IDS.stripePriceId });

      expect(neo4jService.readOne).toHaveBeenCalledTimes(2);
    });
  });
});
