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
    read = jest.fn();
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
import { UsageRecordRepository } from "../usage-record.repository";
import { usageRecordMeta } from "../../entities/usage-record.meta";
import { subscriptionMeta } from "../../entities/subscription.meta";
import { UsageRecord } from "../../entities/usage-record.entity";

describe("UsageRecordRepository", () => {
  let repository: UsageRecordRepository;
  let neo4jService: jest.Mocked<Neo4jService>;

  // Test data constants
  const TEST_IDS = {
    usageRecordId: "550e8400-e29b-41d4-a716-446655440000",
    subscriptionId: "660e8400-e29b-41d4-a716-446655440001",
    meterId: "meter_test123",
    anotherMeterId: "meter_test456",
    stripeEventId: "evt_test789",
  };

  const MOCK_DATES = {
    timestamp: new Date("2025-01-15T12:30:00Z"),
    startTime: new Date("2025-01-01T00:00:00Z"),
    endTime: new Date("2025-02-01T00:00:00Z"),
    createdAt: new Date("2025-01-15T12:30:00Z"),
    updatedAt: new Date("2025-01-15T12:30:00Z"),
  };

  const MOCK_USAGE_RECORD: UsageRecord = {
    id: TEST_IDS.usageRecordId,
    subscriptionId: TEST_IDS.subscriptionId,
    meterId: TEST_IDS.meterId,
    meterEventName: "api_requests",
    quantity: 100,
    timestamp: MOCK_DATES.timestamp,
    stripeEventId: TEST_IDS.stripeEventId,
    createdAt: MOCK_DATES.createdAt,
    updatedAt: MOCK_DATES.updatedAt,
  };

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsageRecordRepository, Neo4jService],
    }).compile();

    repository = module.get<UsageRecordRepository>(UsageRecordRepository);
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
        query: `CREATE CONSTRAINT ${usageRecordMeta.nodeName}_id IF NOT EXISTS FOR (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName}) REQUIRE ${usageRecordMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should create index on subscriptionId field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE INDEX ${usageRecordMeta.nodeName}_subscriptionId_idx IF NOT EXISTS FOR (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName}) ON (${usageRecordMeta.nodeName}.subscriptionId)`,
      });
    });

    it("should create constraint and index in sequence", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should handle constraint creation errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });

    it("should handle index creation errors", async () => {
      const error = new Error("Index creation failed");
      neo4jService.writeOne.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Index creation failed");
    });
  });

  describe("findBySubscriptionId", () => {
    it("should find usage records by subscription ID without time filters", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      const result = await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toEqual({
        subscriptionId: TEST_IDS.subscriptionId,
        limit: 100,
      });
      expect(mockQuery.query).toContain(`MATCH (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName})`);
      expect(mockQuery.query).toContain(`WHERE ${usageRecordMeta.nodeName}.subscriptionId = $subscriptionId`);
      expect(mockQuery.query).toContain(
        `OPTIONAL MATCH (${usageRecordMeta.nodeName})-[:BELONGS_TO]->(${subscriptionMeta.nodeName}:${subscriptionMeta.labelName})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${usageRecordMeta.nodeName}, ${subscriptionMeta.nodeName}`);
      expect(mockQuery.query).toContain(`ORDER BY ${usageRecordMeta.nodeName}.timestamp DESC`);
      expect(mockQuery.query).toContain(`LIMIT $limit`);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_USAGE_RECORD]);
    });

    it("should find usage records with startTime filter only", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      const result = await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
      });

      expect(mockQuery.queryParams).toEqual({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime.toISOString(),
        limit: 100,
      });
      expect(mockQuery.query).toContain(
        `WHERE ${usageRecordMeta.nodeName}.subscriptionId = $subscriptionId AND ${usageRecordMeta.nodeName}.timestamp >= datetime($startTime)`,
      );
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_USAGE_RECORD]);
    });

    it("should find usage records with endTime filter only", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      const result = await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
        endTime: MOCK_DATES.endTime,
      });

      expect(mockQuery.queryParams).toEqual({
        subscriptionId: TEST_IDS.subscriptionId,
        endTime: MOCK_DATES.endTime.toISOString(),
        limit: 100,
      });
      expect(mockQuery.query).toContain(
        `WHERE ${usageRecordMeta.nodeName}.subscriptionId = $subscriptionId AND ${usageRecordMeta.nodeName}.timestamp <= datetime($endTime)`,
      );
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_USAGE_RECORD]);
    });

    it("should find usage records with both startTime and endTime filters (range query)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      const result = await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(mockQuery.queryParams).toEqual({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime.toISOString(),
        endTime: MOCK_DATES.endTime.toISOString(),
        limit: 100,
      });
      expect(mockQuery.query).toContain(
        `WHERE ${usageRecordMeta.nodeName}.subscriptionId = $subscriptionId AND ${usageRecordMeta.nodeName}.timestamp >= datetime($startTime) AND ${usageRecordMeta.nodeName}.timestamp <= datetime($endTime)`,
      );
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_USAGE_RECORD]);
    });

    it("should use default limit of 100 when not specified", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
      });

      expect(mockQuery.queryParams.limit).toBe(100);
    });

    it("should use custom limit when specified", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
        limit: 50,
      });

      expect(mockQuery.queryParams.limit).toBe(50);
    });

    it("should return empty array when no usage records found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
      });

      expect(result).toEqual([]);
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database error");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findBySubscriptionId({ subscriptionId: TEST_IDS.subscriptionId })).rejects.toThrow(
        "Database error",
      );
    });

    it("should order results by timestamp DESC", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
      });

      expect(mockQuery.query).toContain(`ORDER BY ${usageRecordMeta.nodeName}.timestamp DESC`);
    });

    it("should use OPTIONAL MATCH for subscription relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
      });

      expect(mockQuery.query).toContain("OPTIONAL MATCH");
      expect(mockQuery.query).toContain(
        `(${usageRecordMeta.nodeName})-[:BELONGS_TO]->(${subscriptionMeta.nodeName}:${subscriptionMeta.labelName})`,
      );
    });

    it("should convert Date objects to ISO strings for datetime comparison", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(mockQuery.queryParams.startTime).toBe(MOCK_DATES.startTime.toISOString());
      expect(mockQuery.queryParams.endTime).toBe(MOCK_DATES.endTime.toISOString());
      expect(mockQuery.query).toContain("datetime($startTime)");
      expect(mockQuery.query).toContain("datetime($endTime)");
    });

    it("should handle edge case with very large limit", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
        limit: 1000,
      });

      expect(mockQuery.queryParams.limit).toBe(1000);
    });

    it("should handle edge case with limit of 1", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
        limit: 1,
      });

      expect(mockQuery.queryParams.limit).toBe(1);
    });
  });

  describe("create", () => {
    const validCreateParams = {
      subscriptionId: TEST_IDS.subscriptionId,
      meterId: TEST_IDS.meterId,
      meterEventName: "api_requests",
      quantity: 100,
      timestamp: MOCK_DATES.timestamp,
    };

    it("should create usage record with required fields only", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const result = await repository.create(validCreateParams);

      expect(neo4jService.initQuery).toHaveBeenCalledWith({
        serialiser: expect.anything(),
      });
      expect(mockQuery.queryParams).toMatchObject({
        subscriptionId: validCreateParams.subscriptionId,
        meterId: validCreateParams.meterId,
        meterEventName: validCreateParams.meterEventName,
        quantity: validCreateParams.quantity,
        timestamp: MOCK_DATES.timestamp.toISOString(),
        stripeEventId: null,
      });
      expect(mockQuery.queryParams.id).toBeDefined();
      expect(mockQuery.query).toContain(
        `MATCH (${subscriptionMeta.nodeName}:${subscriptionMeta.labelName} {id: $subscriptionId})`,
      );
      expect(mockQuery.query).toContain(`CREATE (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName}`);
      expect(mockQuery.query).toContain("createdAt: datetime()");
      expect(mockQuery.query).toContain("updatedAt: datetime()");
      expect(mockQuery.query).toContain(
        `CREATE (${usageRecordMeta.nodeName})-[:BELONGS_TO]->(${subscriptionMeta.nodeName})`,
      );
      expect(mockQuery.query).toContain(`RETURN ${usageRecordMeta.nodeName}`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_USAGE_RECORD);
    });

    it("should create usage record with optional stripeEventId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const paramsWithEventId = {
        ...validCreateParams,
        stripeEventId: TEST_IDS.stripeEventId,
      };

      await repository.create(paramsWithEventId);

      expect(mockQuery.queryParams.stripeEventId).toBe(TEST_IDS.stripeEventId);
    });

    it("should create usage record without stripeEventId (null)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.stripeEventId).toBeNull();
    });

    it("should convert Date objects to ISO strings for Neo4j datetime", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      await repository.create(validCreateParams);

      expect(mockQuery.queryParams.timestamp).toBe(MOCK_DATES.timestamp.toISOString());
      expect(mockQuery.query).toContain("timestamp: datetime($timestamp)");
    });

    it("should generate unique UUID for each usage record", async () => {
      const mockQuery1 = createMockQuery();
      const mockQuery2 = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(mockQuery1).mockReturnValueOnce(mockQuery2);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      await repository.create(validCreateParams);
      await repository.create(validCreateParams);

      expect(mockQuery1.queryParams.id).toBeDefined();
      expect(mockQuery2.queryParams.id).toBeDefined();
      expect(mockQuery1.queryParams.id).not.toEqual(mockQuery2.queryParams.id);
    });

    it("should handle creation errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Creation failed - subscription not found");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.create(validCreateParams)).rejects.toThrow("Creation failed - subscription not found");
    });

    it("should create BELONGS_TO relationship to subscription", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      await repository.create(validCreateParams);

      expect(mockQuery.query).toContain(
        `CREATE (${usageRecordMeta.nodeName})-[:BELONGS_TO]->(${subscriptionMeta.nodeName})`,
      );
    });

    it("should handle zero quantity", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const paramsWithZeroQuantity = {
        ...validCreateParams,
        quantity: 0,
      };

      await repository.create(paramsWithZeroQuantity);

      expect(mockQuery.queryParams.quantity).toBe(0);
    });

    it("should handle large quantity values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const paramsWithLargeQuantity = {
        ...validCreateParams,
        quantity: 999999,
      };

      await repository.create(paramsWithLargeQuantity);

      expect(mockQuery.queryParams.quantity).toBe(999999);
    });

    it("should handle negative quantity values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const paramsWithNegativeQuantity = {
        ...validCreateParams,
        quantity: -50,
      };

      await repository.create(paramsWithNegativeQuantity);

      expect(mockQuery.queryParams.quantity).toBe(-50);
    });

    it("should preserve exact meter event name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const exactEventName = "custom.metered.event";

      await repository.create({
        ...validCreateParams,
        meterEventName: exactEventName,
      });

      expect(mockQuery.queryParams.meterEventName).toBe(exactEventName);
    });

    it("should handle empty string for stripeEventId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      await repository.create({
        ...validCreateParams,
        stripeEventId: "",
      });

      expect(mockQuery.queryParams.stripeEventId).toBe("");
    });
  });

  describe("getUsageSummary", () => {
    it("should return usage summary with total, count, and byMeter aggregation", async () => {
      const mockDbResult = [
        {
          total: 500,
          count: 5,
          records: [
            { meterId: TEST_IDS.meterId, quantity: 100 },
            { meterId: TEST_IDS.meterId, quantity: 150 },
            { meterId: TEST_IDS.anotherMeterId, quantity: 200 },
            { meterId: TEST_IDS.meterId, quantity: 50 },
          ],
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(neo4jService.read).toHaveBeenCalledWith(
        expect.stringContaining(`MATCH (${usageRecordMeta.nodeName}:${usageRecordMeta.labelName})`),
        expect.objectContaining({
          subscriptionId: TEST_IDS.subscriptionId,
          startTime: MOCK_DATES.startTime.toISOString(),
          endTime: MOCK_DATES.endTime.toISOString(),
        }),
      );

      expect(result).toEqual({
        total: 500,
        count: 5,
        byMeter: {
          [TEST_IDS.meterId]: 300,
          [TEST_IDS.anotherMeterId]: 200,
        },
      });
    });

    it("should filter by subscriptionId in WHERE clause", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 100,
          count: 1,
          records: [{ meterId: TEST_IDS.meterId, quantity: 100 }],
        },
      ]);

      await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      const [cypher, params] = neo4jService.read.mock.calls[0];

      expect(cypher).toContain(`WHERE ${usageRecordMeta.nodeName}.subscriptionId = $subscriptionId`);
      expect(params.subscriptionId).toBe(TEST_IDS.subscriptionId);
    });

    it("should filter by time range with >= and <= operators", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 100,
          count: 1,
          records: [{ meterId: TEST_IDS.meterId, quantity: 100 }],
        },
      ]);

      await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      const [cypher, params] = neo4jService.read.mock.calls[0];

      expect(cypher).toContain(`${usageRecordMeta.nodeName}.timestamp >= datetime($startTime)`);
      expect(cypher).toContain(`${usageRecordMeta.nodeName}.timestamp <= datetime($endTime)`);
      expect(params.startTime).toBe(MOCK_DATES.startTime.toISOString());
      expect(params.endTime).toBe(MOCK_DATES.endTime.toISOString());
    });

    it("should use sum() aggregation for total quantity", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 500,
          count: 5,
          records: [],
        },
      ]);

      await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      const [cypher] = neo4jService.read.mock.calls[0];

      expect(cypher).toContain(`sum(${usageRecordMeta.nodeName}.quantity) as total`);
    });

    it("should use count() aggregation for record count", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 500,
          count: 5,
          records: [],
        },
      ]);

      await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      const [cypher] = neo4jService.read.mock.calls[0];

      expect(cypher).toContain(`count(${usageRecordMeta.nodeName}) as count`);
    });

    it("should use collect() for gathering records by meter", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 100,
          count: 1,
          records: [{ meterId: TEST_IDS.meterId, quantity: 100 }],
        },
      ]);

      await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      const [cypher] = neo4jService.read.mock.calls[0];

      expect(cypher).toContain("collect({meterId:");
      expect(cypher).toContain("quantity:");
      expect(cypher).toContain("}) as records");
    });

    it("should return {total: 0, count: 0, byMeter: {}} when no results", async () => {
      neo4jService.read.mockResolvedValue([]);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result).toEqual({
        total: 0,
        count: 0,
        byMeter: {},
      });
    });

    it("should return {total: 0, count: 0, byMeter: {}} when result is null", async () => {
      neo4jService.read.mockResolvedValue(null as any);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result).toEqual({
        total: 0,
        count: 0,
        byMeter: {},
      });
    });

    it("should handle multiple meters with different IDs", async () => {
      const mockDbResult = [
        {
          total: 1000,
          count: 6,
          records: [
            { meterId: "meter_1", quantity: 100 },
            { meterId: "meter_2", quantity: 200 },
            { meterId: "meter_3", quantity: 300 },
            { meterId: "meter_1", quantity: 150 },
            { meterId: "meter_2", quantity: 50 },
            { meterId: "meter_1", quantity: 200 },
          ],
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result).toEqual({
        total: 1000,
        count: 6,
        byMeter: {
          meter_1: 450,
          meter_2: 250,
          meter_3: 300,
        },
      });
    });

    it("should use neo4j.read() directly (not initQuery/readOne/readMany pattern)", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 100,
          count: 1,
          records: [{ meterId: TEST_IDS.meterId, quantity: 100 }],
        },
      ]);

      await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(neo4jService.read).toHaveBeenCalledTimes(1);
      expect(neo4jService.initQuery).not.toHaveBeenCalled();
      expect(neo4jService.readOne).not.toHaveBeenCalled();
      expect(neo4jService.readMany).not.toHaveBeenCalled();
    });

    it("should handle empty records array gracefully", async () => {
      const mockDbResult = [
        {
          total: 0,
          count: 0,
          records: [],
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result).toEqual({
        total: 0,
        count: 0,
        byMeter: {},
      });
    });

    it("should convert numeric values from database response", async () => {
      const mockDbResult = [
        {
          total: "500",
          count: "5",
          records: [{ meterId: TEST_IDS.meterId, quantity: "100" }],
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult as any);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result.total).toBe(500);
      expect(result.count).toBe(5);
      expect(typeof result.total).toBe("number");
      expect(typeof result.count).toBe("number");
    });

    it("should handle null total and count gracefully", async () => {
      const mockDbResult = [
        {
          total: null,
          count: null,
          records: null,
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult as any);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result).toEqual({
        total: 0,
        count: 0,
        byMeter: {},
      });
    });

    it("should use WITH clause for aggregation", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 100,
          count: 1,
          records: [{ meterId: TEST_IDS.meterId, quantity: 100 }],
        },
      ]);

      await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      const [cypher] = neo4jService.read.mock.calls[0];

      expect(cypher).toContain(`WITH ${usageRecordMeta.nodeName}`);
    });

    it("should handle database errors", async () => {
      const error = new Error("Database read error");
      neo4jService.read.mockRejectedValue(error);

      await expect(
        repository.getUsageSummary({
          subscriptionId: TEST_IDS.subscriptionId,
          startTime: MOCK_DATES.startTime,
          endTime: MOCK_DATES.endTime,
        }),
      ).rejects.toThrow("Database read error");
    });

    it("should require both startTime and endTime parameters", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 100,
          count: 1,
          records: [{ meterId: TEST_IDS.meterId, quantity: 100 }],
        },
      ]);

      const params = {
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      };

      await repository.getUsageSummary(params);

      const [, queryParams] = neo4jService.read.mock.calls[0];

      expect(queryParams.startTime).toBeDefined();
      expect(queryParams.endTime).toBeDefined();
    });

    it("should aggregate quantities per meter correctly with decimal values", async () => {
      const mockDbResult = [
        {
          total: 350.5,
          count: 4,
          records: [
            { meterId: TEST_IDS.meterId, quantity: 100.5 },
            { meterId: TEST_IDS.meterId, quantity: 50 },
            { meterId: TEST_IDS.anotherMeterId, quantity: 150 },
            { meterId: TEST_IDS.anotherMeterId, quantity: 50 },
          ],
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result.byMeter[TEST_IDS.meterId]).toBe(150.5);
      expect(result.byMeter[TEST_IDS.anotherMeterId]).toBe(200);
    });

    it("should handle quantities with null values in records", async () => {
      const mockDbResult = [
        {
          total: 100,
          count: 3,
          records: [
            { meterId: TEST_IDS.meterId, quantity: 100 },
            { meterId: TEST_IDS.meterId, quantity: null },
            { meterId: TEST_IDS.anotherMeterId, quantity: null },
          ],
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult as any);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result.byMeter[TEST_IDS.meterId]).toBe(100);
      expect(result.byMeter[TEST_IDS.anotherMeterId]).toBe(0);
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery with serialiser for read operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({ subscriptionId: TEST_IDS.subscriptionId });

      expect(neo4jService.initQuery).toHaveBeenCalledWith({ serialiser: expect.anything() });
    });

    it("should call Neo4jService.writeOne for create operations", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      await repository.create({
        subscriptionId: TEST_IDS.subscriptionId,
        meterId: TEST_IDS.meterId,
        meterEventName: "api_requests",
        quantity: 100,
        timestamp: MOCK_DATES.timestamp,
      });

      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should call Neo4jService.read directly for aggregation operations", async () => {
      neo4jService.read.mockResolvedValue([
        {
          total: 100,
          count: 1,
          records: [{ meterId: TEST_IDS.meterId, quantity: 100 }],
        },
      ]);

      await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(neo4jService.read).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
    });

    it("should use readMany for findBySubscriptionId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      await repository.findBySubscriptionId({ subscriptionId: TEST_IDS.subscriptionId });

      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very large quantity values in aggregation", async () => {
      const mockDbResult = [
        {
          total: 999999999,
          count: 2,
          records: [
            { meterId: TEST_IDS.meterId, quantity: 999999998 },
            { meterId: TEST_IDS.meterId, quantity: 1 },
          ],
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result.total).toBe(999999999);
      expect(result.byMeter[TEST_IDS.meterId]).toBe(999999999);
    });

    it("should handle future dates for timestamp", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const futureDate = new Date("2099-12-31T23:59:59Z");

      await repository.create({
        subscriptionId: TEST_IDS.subscriptionId,
        meterId: TEST_IDS.meterId,
        meterEventName: "api_requests",
        quantity: 100,
        timestamp: futureDate,
      });

      expect(mockQuery.queryParams.timestamp).toBe(futureDate.toISOString());
    });

    it("should handle past dates for time range filters", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      const pastStartDate = new Date("2000-01-01T00:00:00Z");
      const pastEndDate = new Date("2000-12-31T23:59:59Z");

      await repository.findBySubscriptionId({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: pastStartDate,
        endTime: pastEndDate,
      });

      expect(mockQuery.queryParams.startTime).toBe(pastStartDate.toISOString());
      expect(mockQuery.queryParams.endTime).toBe(pastEndDate.toISOString());
    });

    it("should handle exact datetime values after ISO conversion", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const exactDate = new Date("2025-06-15T14:30:00.000Z");

      await repository.create({
        subscriptionId: TEST_IDS.subscriptionId,
        meterId: TEST_IDS.meterId,
        meterEventName: "api_requests",
        quantity: 100,
        timestamp: exactDate,
      });

      expect(mockQuery.queryParams.timestamp).toBe("2025-06-15T14:30:00.000Z");
    });

    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USAGE_RECORD]);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";

      await repository.findBySubscriptionId({ subscriptionId: exactId });

      expect(mockQuery.queryParams.subscriptionId).toBe(exactId);
    });

    it("should handle single record in aggregation", async () => {
      const mockDbResult = [
        {
          total: 100,
          count: 1,
          records: [{ meterId: TEST_IDS.meterId, quantity: 100 }],
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result).toEqual({
        total: 100,
        count: 1,
        byMeter: {
          [TEST_IDS.meterId]: 100,
        },
      });
    });

    it("should handle many records for same meter", async () => {
      const records = Array.from({ length: 100 }, () => ({
        meterId: TEST_IDS.meterId,
        quantity: 10,
      }));

      const mockDbResult = [
        {
          total: 1000,
          count: 100,
          records,
        },
      ];

      neo4jService.read.mockResolvedValue(mockDbResult);

      const result = await repository.getUsageSummary({
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: MOCK_DATES.startTime,
        endTime: MOCK_DATES.endTime,
      });

      expect(result).toEqual({
        total: 1000,
        count: 100,
        byMeter: {
          [TEST_IDS.meterId]: 1000,
        },
      });
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact meterId format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const exactMeterId = "meter_1MvN8z3FkJ0LJ6p";

      await repository.create({
        subscriptionId: TEST_IDS.subscriptionId,
        meterId: exactMeterId,
        meterEventName: "api_requests",
        quantity: 100,
        timestamp: MOCK_DATES.timestamp,
      });

      expect(mockQuery.queryParams.meterId).toBe(exactMeterId);
    });

    it("should preserve exact stripeEventId format", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      const exactEventId = "evt_1MvN8z3FkJ0LJ6p";

      await repository.create({
        subscriptionId: TEST_IDS.subscriptionId,
        meterId: TEST_IDS.meterId,
        meterEventName: "api_requests",
        quantity: 100,
        timestamp: MOCK_DATES.timestamp,
        stripeEventId: exactEventId,
      });

      expect(mockQuery.queryParams.stripeEventId).toBe(exactEventId);
    });

    it("should preserve floating point quantity values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_USAGE_RECORD);

      await repository.create({
        subscriptionId: TEST_IDS.subscriptionId,
        meterId: TEST_IDS.meterId,
        meterEventName: "api_requests",
        quantity: 123.456,
        timestamp: MOCK_DATES.timestamp,
      });

      expect(mockQuery.queryParams.quantity).toBe(123.456);
    });
  });
});
