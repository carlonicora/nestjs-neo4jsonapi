import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCrudHandlers, ListQueryParams } from "../crud.handlers";

const TEST_IDS = {
  entityId: "550e8400-e29b-41d4-a716-446655440000",
};

const MOCK_RESPONSE = {
  data: { id: TEST_IDS.entityId, type: "test-entities", attributes: { name: "Test" } },
};

const createMockService = () => ({
  find: vi.fn().mockResolvedValue(MOCK_RESPONSE),
  findById: vi.fn().mockResolvedValue(MOCK_RESPONSE),
  createFromDTO: vi.fn().mockResolvedValue(MOCK_RESPONSE),
  putFromDTO: vi.fn().mockResolvedValue(MOCK_RESPONSE),
  patchFromDTO: vi.fn().mockResolvedValue(MOCK_RESPONSE),
  delete: vi.fn().mockResolvedValue(undefined),
});

const createMockReply = () => ({
  send: vi.fn(),
});

describe("createCrudHandlers", () => {
  let mockService: ReturnType<typeof createMockService>;
  let mockReply: ReturnType<typeof createMockReply>;
  let handlers: ReturnType<typeof createCrudHandlers>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    mockReply = createMockReply();
    handlers = createCrudHandlers(() => mockService as any);
  });

  describe("factory function", () => {
    it("should return an object with all 6 handler methods", () => {
      expect(handlers).toHaveProperty("findAll");
      expect(handlers).toHaveProperty("findById");
      expect(handlers).toHaveProperty("create");
      expect(handlers).toHaveProperty("update");
      expect(handlers).toHaveProperty("patch");
      expect(handlers).toHaveProperty("delete");
      expect(typeof handlers.findAll).toBe("function");
      expect(typeof handlers.findById).toBe("function");
      expect(typeof handlers.create).toBe("function");
      expect(typeof handlers.update).toBe("function");
      expect(typeof handlers.patch).toBe("function");
      expect(typeof handlers.delete).toBe("function");
    });
  });

  describe("findAll", () => {
    it("should call service.find with correct params and send response", async () => {
      const params: ListQueryParams = {
        query: { include: "relationships" },
        search: "test search",
        fetchAll: true,
        orderBy: "createdAt",
      };

      await handlers.findAll(mockReply as any, params);

      expect(mockService.find).toHaveBeenCalledTimes(1);
      expect(mockService.find).toHaveBeenCalledWith({
        term: "test search",
        query: { include: "relationships" },
        fetchAll: true,
        orderBy: "createdAt",
      });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should handle optional params being undefined", async () => {
      const params: ListQueryParams = {
        query: {},
      };

      await handlers.findAll(mockReply as any, params);

      expect(mockService.find).toHaveBeenCalledWith({
        term: undefined,
        query: {},
        fetchAll: undefined,
        orderBy: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should propagate service errors", async () => {
      const error = new Error("Service error");
      mockService.find.mockRejectedValue(error);

      await expect(handlers.findAll(mockReply as any, { query: {} })).rejects.toThrow("Service error");
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("should call service.findById with correct id and send response", async () => {
      await handlers.findById(mockReply as any, TEST_IDS.entityId);

      expect(mockService.findById).toHaveBeenCalledTimes(1);
      expect(mockService.findById).toHaveBeenCalledWith({ id: TEST_IDS.entityId });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should propagate service errors", async () => {
      const error = new Error("Not found");
      mockService.findById.mockRejectedValue(error);

      await expect(handlers.findById(mockReply as any, TEST_IDS.entityId)).rejects.toThrow("Not found");
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("should call service.createFromDTO with body data and send response", async () => {
      const body = {
        data: { type: "test-entities", attributes: { name: "New Entity" } },
      };

      await handlers.create(mockReply as any, body);

      expect(mockService.createFromDTO).toHaveBeenCalledTimes(1);
      expect(mockService.createFromDTO).toHaveBeenCalledWith({
        data: body.data,
      });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should propagate service errors", async () => {
      const error = new Error("Validation failed");
      mockService.createFromDTO.mockRejectedValue(error);

      await expect(handlers.create(mockReply as any, { data: {} })).rejects.toThrow("Validation failed");
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should call service.putFromDTO with body data and send response", async () => {
      const body = {
        data: { id: TEST_IDS.entityId, type: "test-entities", attributes: { name: "Updated" } },
      };

      await handlers.update(mockReply as any, body);

      expect(mockService.putFromDTO).toHaveBeenCalledTimes(1);
      expect(mockService.putFromDTO).toHaveBeenCalledWith({
        data: body.data,
      });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should propagate service errors", async () => {
      const error = new Error("Update failed");
      mockService.putFromDTO.mockRejectedValue(error);

      await expect(handlers.update(mockReply as any, { data: {} })).rejects.toThrow("Update failed");
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("patch", () => {
    it("should call service.patchFromDTO with body data and send response", async () => {
      const body = {
        data: { id: TEST_IDS.entityId, type: "test-entities", attributes: { name: "Patched" } },
      };

      await handlers.patch(mockReply as any, body);

      expect(mockService.patchFromDTO).toHaveBeenCalledTimes(1);
      expect(mockService.patchFromDTO).toHaveBeenCalledWith({
        data: body.data,
      });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_RESPONSE);
    });

    it("should propagate service errors", async () => {
      const error = new Error("Patch failed");
      mockService.patchFromDTO.mockRejectedValue(error);

      await expect(handlers.patch(mockReply as any, { data: {} })).rejects.toThrow("Patch failed");
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should call service.delete with correct id and send empty response", async () => {
      await handlers.delete(mockReply as any, TEST_IDS.entityId);

      expect(mockService.delete).toHaveBeenCalledTimes(1);
      expect(mockService.delete).toHaveBeenCalledWith({ id: TEST_IDS.entityId });
      expect(mockReply.send).toHaveBeenCalledTimes(1);
      expect(mockReply.send).toHaveBeenCalledWith();
    });

    it("should propagate service errors", async () => {
      const error = new Error("Delete failed");
      mockService.delete.mockRejectedValue(error);

      await expect(handlers.delete(mockReply as any, TEST_IDS.entityId)).rejects.toThrow("Delete failed");
      expect(mockReply.send).not.toHaveBeenCalled();
    });
  });
});
