import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { PushRepository } from "../push.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { Push } from "../../entities/push.entity";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  pushId1: "770e8400-e29b-41d4-a716-446655440002",
  pushId2: "880e8400-e29b-41d4-a716-446655440003",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
});

describe("PushRepository", () => {
  let repository: PushRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_PUSH_SUBSCRIPTION: Push = {
    id: TEST_IDS.pushId1,
    endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
    p256dh: "test-p256dh-key",
    auth: "test-auth-key",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as Push;

  const MOCK_PUSH_SUBSCRIPTION_2: Push = {
    id: TEST_IDS.pushId2,
    endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-2",
    p256dh: "test-p256dh-key-2",
    auth: "test-auth-key-2",
    createdAt: new Date("2025-01-02T00:00:00Z"),
    updatedAt: new Date("2025-01-02T00:00:00Z"),
  } as Push;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PushRepository, { provide: Neo4jService, useValue: neo4jService }],
    }).compile();

    repository = module.get<PushRepository>(PushRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findByUserId", () => {
    it("should find push subscriptions by user ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_PUSH_SUBSCRIPTION]);

      const result = await repository.findByUserId({ userId: TEST_IDS.userId });

      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.query).toContain("MATCH (user:User {id: $userId})");
      expect(mockQuery.query).toContain("[:BELONGS_TO]->(company)");
      expect(mockQuery.query).toContain("[:HAS_PUSH]-(user)");
      expect(mockQuery.query).toContain("RETURN push");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_PUSH_SUBSCRIPTION]);
    });

    it("should return multiple push subscriptions for user", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_PUSH_SUBSCRIPTION, MOCK_PUSH_SUBSCRIPTION_2]);

      const result = await repository.findByUserId({ userId: TEST_IDS.userId });

      expect(result).toHaveLength(2);
      expect(result).toEqual([MOCK_PUSH_SUBSCRIPTION, MOCK_PUSH_SUBSCRIPTION_2]);
    });

    it("should return empty array when no push subscriptions found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByUserId({ userId: TEST_IDS.userId });

      expect(result).toEqual([]);
    });

    it("should handle errors from Neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockRejectedValue(new Error("Database error"));

      await expect(repository.findByUserId({ userId: TEST_IDS.userId })).rejects.toThrow("Database error");
    });
  });

  describe("findByEndpoint", () => {
    it("should find push subscriptions by endpoint", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_PUSH_SUBSCRIPTION]);

      const endpoint = "https://fcm.googleapis.com/fcm/send/test-endpoint";
      const result = await repository.findByEndpoint({ endpoint });

      expect(mockQuery.queryParams.endpoint).toBe(endpoint);
      expect(mockQuery.query).toContain("MATCH (user:User {id: $currentUserId})");
      expect(mockQuery.query).toContain("[:BELONGS_TO]->(company)");
      expect(mockQuery.query).toContain("(push:PushSubscription {endpoint: $endpoint})");
      expect(mockQuery.query).toContain("[:HAS_PUSH]-(user)");
      expect(mockQuery.query).toContain("RETURN push");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_PUSH_SUBSCRIPTION]);
    });

    it("should return empty array when endpoint not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByEndpoint({
        endpoint: "https://nonexistent-endpoint.com",
      });

      expect(result).toEqual([]);
    });

    it("should handle errors from Neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockRejectedValue(new Error("Database error"));

      await expect(repository.findByEndpoint({ endpoint: "https://test-endpoint.com" })).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("create", () => {
    it("should upsert a push subscription idempotently (MERGE on endpoint, MERGE the per-user edge)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const params = {
        endpoint: "https://fcm.googleapis.com/fcm/send/new-endpoint",
        p256dh: "new-p256dh-key",
        auth: "new-auth-key",
      };

      await repository.create(params);

      expect(mockQuery.queryParams.endpoint).toBe(params.endpoint);
      expect(mockQuery.queryParams.p256dh).toBe(params.p256dh);
      expect(mockQuery.queryParams.auth).toBe(params.auth);
      expect(mockQuery.queryParams.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(mockQuery.query).toContain("MATCH (user:User {id: $currentUserId})");
      // A subscription is browser-scoped, not company-scoped: MERGE on endpoint
      // (one node per endpoint) so re-registration/shared-browser logins never
      // duplicate, and the id is set only ON CREATE so it stays stable.
      expect(mockQuery.query).toContain("MERGE (push:PushSubscription {endpoint: $endpoint})");
      expect(mockQuery.query).toContain("ON CREATE SET push.id = $id");
      expect(mockQuery.query).toContain("push.createdAt = datetime()");
      expect(mockQuery.query).toContain("push.p256dh = $p256dh");
      expect(mockQuery.query).toContain("push.auth = $auth");
      expect(mockQuery.query).toContain("push.updatedAt = datetime()");
      expect(mockQuery.query).toContain("MERGE (user)-[:HAS_PUSH]->(push)");
      expect(mockQuery.query).not.toContain("CREATE (push:PushSubscription");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should generate unique UUID for each push subscription", async () => {
      const mockQuery1 = createMockQuery();
      const mockQuery2 = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(mockQuery1).mockReturnValueOnce(mockQuery2);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const params = {
        endpoint: "https://test-endpoint.com",
        p256dh: "test-p256dh",
        auth: "test-auth",
      };

      await repository.create(params);
      await repository.create(params);

      expect(mockQuery1.queryParams.id).not.toBe(mockQuery2.queryParams.id);
    });

    it("should handle errors from Neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockRejectedValue(new Error("Database error"));

      await expect(
        repository.create({
          endpoint: "https://test-endpoint.com",
          p256dh: "test-p256dh",
          auth: "test-auth",
        }),
      ).rejects.toThrow("Database error");
    });
  });

  describe("deleteByEndpoint", () => {
    it("should delete by endpoint globally, without user/company scoping", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const endpoint = "https://fcm.googleapis.com/fcm/send/dead-endpoint";
      await repository.deleteByEndpoint({ endpoint });

      expect(mockQuery.queryParams.endpoint).toBe(endpoint);
      expect(mockQuery.query).toContain("MATCH (push:PushSubscription {endpoint: $endpoint})");
      expect(mockQuery.query).toContain("DETACH DELETE push");
      // A 404/410 can arrive from a worker with no CLS user; scoping would no-op
      // and leave the dead row, so the delete is intentionally unscoped.
      expect(mockQuery.query).not.toContain("$currentUserId");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle errors from Neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockRejectedValue(new Error("Database error"));

      await expect(repository.deleteByEndpoint({ endpoint: "https://test-endpoint.com" })).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact endpoint values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const specialEndpoint = "https://fcm.googleapis.com/fcm/send/special-chars?foo=bar&baz=qux";
      await repository.findByEndpoint({ endpoint: specialEndpoint });

      expect(mockQuery.queryParams.endpoint).toBe(specialEndpoint);
    });

    it("should handle long endpoint URLs", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const longEndpoint = "https://fcm.googleapis.com/fcm/send/" + "a".repeat(500);
      await repository.findByEndpoint({ endpoint: longEndpoint });

      expect(mockQuery.queryParams.endpoint).toBe(longEndpoint);
    });
  });
});
