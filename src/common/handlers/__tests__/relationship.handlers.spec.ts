import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRelationshipHandlers, RelatedQueryParams } from "../relationship.handlers";

const TEST_IDS = {
  entityId: "550e8400-e29b-41d4-a716-446655440000",
  relatedId: "660e8400-e29b-41d4-a716-446655440001",
  relatedId2: "770e8400-e29b-41d4-a716-446655440002",
};

const MOCK_RESPONSE = {
  data: [{ id: TEST_IDS.entityId, type: "test-entities", attributes: { name: "Test" } }],
};

const createMockService = () => ({
  findByRelated: vi.fn().mockResolvedValue(MOCK_RESPONSE),
  addToRelationshipFromDTO: vi.fn().mockResolvedValue(MOCK_RESPONSE),
  removeFromRelationshipFromDTO: vi.fn().mockResolvedValue(MOCK_RESPONSE),
});

const createMockReply = () => ({
  send: vi.fn(),
});

describe("createRelationshipHandlers", () => {
  let mockService: ReturnType<typeof createMockService>;
  let mockReply: ReturnType<typeof createMockReply>;
  let handlers: ReturnType<typeof createRelationshipHandlers>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    mockReply = createMockReply();
    handlers = createRelationshipHandlers(() => mockService as any);
  });

  describe("factory function", () => {
    it("should return an object with all 3 handler methods", () => {
      expect(handlers).toHaveProperty("findByRelated");
      expect(handlers).toHaveProperty("addToRelationship");
      expect(handlers).toHaveProperty("removeFromRelationship");
      expect(typeof handlers.findByRelated).toBe("function");
      expect(typeof handlers.addToRelationship).toBe("function");
      expect(typeof handlers.removeFromRelationship).toBe("function");
    });
  });

  describe("findByRelated", () => {
    it("should call service.findByRelated with single ID and send response", async () => {
      const params: RelatedQueryParams = {
        relationship: "owner",
        id: TEST_IDS.relatedId,
        query: { include: "photographs" },
        search: "test",
        fetchAll: true,
        orderBy: "createdAt",
      };

      await handlers.findByRelated(mockReply as any, params);

      expect(mockService.findByRelated).toHaveBeenCalledTimes(1);
      expect(mockService.findByRelated).toHaveBeenCalledWith({
        relationship: "owner",
        id: TEST_IDS.relatedId,
        term: "test",
        query: { include: "photographs" },
        fetchAll: true,
        orderBy: "createdAt",
      });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should call service.findByRelated with array of IDs", async () => {
      const params: RelatedQueryParams = {
        relationship: "photographs",
        id: [TEST_IDS.relatedId, TEST_IDS.relatedId2],
        query: {},
      };

      await handlers.findByRelated(mockReply as any, params);

      expect(mockService.findByRelated).toHaveBeenCalledWith({
        relationship: "photographs",
        id: [TEST_IDS.relatedId, TEST_IDS.relatedId2],
        term: undefined,
        query: {},
        fetchAll: undefined,
        orderBy: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should handle optional params being undefined", async () => {
      const params: RelatedQueryParams = {
        relationship: "owner",
        id: TEST_IDS.relatedId,
        query: {},
      };

      await handlers.findByRelated(mockReply as any, params);

      expect(mockService.findByRelated).toHaveBeenCalledWith({
        relationship: "owner",
        id: TEST_IDS.relatedId,
        term: undefined,
        query: {},
        fetchAll: undefined,
        orderBy: undefined,
      });
    });

    it("should propagate service errors", async () => {
      const error = new Error("Service error");
      mockService.findByRelated.mockRejectedValue(error);

      await expect(
        handlers.findByRelated(mockReply as any, {
          relationship: "owner",
          id: TEST_IDS.relatedId,
          query: {},
        }),
      ).rejects.toThrow("Service error");
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("addToRelationship", () => {
    it("should call service.addToRelationshipFromDTO with correct params and send response", async () => {
      const data = { id: TEST_IDS.relatedId, type: "photographs" };

      await handlers.addToRelationship(mockReply as any, TEST_IDS.entityId, "photographs", data);

      expect(mockService.addToRelationshipFromDTO).toHaveBeenCalledTimes(1);
      expect(mockService.addToRelationshipFromDTO).toHaveBeenCalledWith({
        id: TEST_IDS.entityId,
        relationship: "photographs",
        data,
      });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should handle array data for batch operations", async () => {
      const data = [
        { id: TEST_IDS.relatedId, type: "photographs" },
        { id: TEST_IDS.relatedId2, type: "photographs" },
      ];

      await handlers.addToRelationship(mockReply as any, TEST_IDS.entityId, "photographs", data);

      expect(mockService.addToRelationshipFromDTO).toHaveBeenCalledWith({
        id: TEST_IDS.entityId,
        relationship: "photographs",
        data,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should propagate service errors", async () => {
      const error = new Error("Add relationship failed");
      mockService.addToRelationshipFromDTO.mockRejectedValue(error);

      await expect(handlers.addToRelationship(mockReply as any, TEST_IDS.entityId, "photographs", {})).rejects.toThrow(
        "Add relationship failed",
      );
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("removeFromRelationship", () => {
    it("should call service.removeFromRelationshipFromDTO with correct params and send response", async () => {
      const data = [{ id: TEST_IDS.relatedId, type: "photographs" }];

      await handlers.removeFromRelationship(mockReply as any, TEST_IDS.entityId, "photographs", data);

      expect(mockService.removeFromRelationshipFromDTO).toHaveBeenCalledTimes(1);
      expect(mockService.removeFromRelationshipFromDTO).toHaveBeenCalledWith({
        id: TEST_IDS.entityId,
        relationship: "photographs",
        data,
      });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should handle multiple items in data array", async () => {
      const data = [
        { id: TEST_IDS.relatedId, type: "photographs" },
        { id: TEST_IDS.relatedId2, type: "photographs" },
      ];

      await handlers.removeFromRelationship(mockReply as any, TEST_IDS.entityId, "photographs", data);

      expect(mockService.removeFromRelationshipFromDTO).toHaveBeenCalledWith({
        id: TEST_IDS.entityId,
        relationship: "photographs",
        data,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should propagate service errors", async () => {
      const error = new Error("Remove relationship failed");
      mockService.removeFromRelationshipFromDTO.mockRejectedValue(error);

      await expect(
        handlers.removeFromRelationship(mockReply as any, TEST_IDS.entityId, "photographs", []),
      ).rejects.toThrow("Remove relationship failed");
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });
});
