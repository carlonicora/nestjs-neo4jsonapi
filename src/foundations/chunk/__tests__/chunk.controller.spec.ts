import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock chunkMeta used in controller decorator
vi.mock("../entities/chunk.meta", () => ({
  chunkMeta: {
    type: "chunks",
    endpoint: "chunks",
    nodeName: "chunk",
    labelName: "Chunk",
  },
}));

// Mock chunk service to avoid complex dependency chain
vi.mock("../services/chunk.service", () => ({
  ChunkService: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
  })),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ChunkController } from "../controllers/chunk.controller";
import { ChunkService } from "../services/chunk.service";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";

describe("ChunkController", () => {
  let controller: ChunkController;
  let chunkService: vi.Mocked<ChunkService>;

  const TEST_IDS = {
    chunkId: "550e8400-e29b-41d4-a716-446655440001",
  };

  beforeEach(async () => {
    const mockChunkService = {
      findById: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChunkController],
      providers: [{ provide: ChunkService, useValue: mockChunkService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChunkController>(ChunkController);
    chunkService = module.get(ChunkService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /chunks/:chunkId (findById)", () => {
    it("should return chunk by id", async () => {
      const mockChunk = {
        data: {
          type: "chunks",
          id: TEST_IDS.chunkId,
          attributes: {
            content: "Test chunk content",
            position: 1,
          },
        },
      };
      chunkService.findById.mockResolvedValue(mockChunk);

      const result = await controller.findById(TEST_IDS.chunkId);

      expect(chunkService.findById).toHaveBeenCalledWith({ chunkId: TEST_IDS.chunkId });
      expect(result).toEqual(mockChunk);
    });

    it("should pass chunkId from path params", async () => {
      const customChunkId = "custom-chunk-123";
      chunkService.findById.mockResolvedValue({ data: {} } as any);

      await controller.findById(customChunkId);

      expect(chunkService.findById).toHaveBeenCalledWith({ chunkId: customChunkId });
    });

    it("should handle service errors", async () => {
      chunkService.findById.mockRejectedValue(new Error("Chunk not found"));

      await expect(controller.findById(TEST_IDS.chunkId)).rejects.toThrow("Chunk not found");
    });

    it("should handle non-existent chunk", async () => {
      chunkService.findById.mockRejectedValue(new Error("Not found"));

      await expect(controller.findById("non-existent-id")).rejects.toThrow("Not found");
    });
  });

  describe("dependency injection", () => {
    it("should have chunkService injected", () => {
      expect(controller["chunkService"]).toBeDefined();
    });
  });
});
