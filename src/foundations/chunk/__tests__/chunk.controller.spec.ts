import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";

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
import { getQueueToken } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { ChunkController } from "../controllers/chunk.controller";
import { ChunkService } from "../services/chunk.service";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { RoleId } from "../../../common/constants/system.roles";

describe("ChunkController", () => {
  let controller: ChunkController;
  let chunkService: Mocked<ChunkService>;

  const TEST_IDS = {
    chunkId: "550e8400-e29b-41d4-a716-446655440001",
  };

  beforeEach(async () => {
    const mockChunkService = {
      findById: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChunkController],
      providers: [
        { provide: ChunkService, useValue: mockChunkService },
        { provide: ClsService, useValue: { get: vi.fn() } },
        { provide: getQueueToken("embedding-chunks"), useValue: { add: vi.fn() } },
        { provide: getQueueToken("embedding-keyconcepts"), useValue: { add: vi.fn() } },
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue({ process: {} }) } },
      ],
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
      const mockChunk: JsonApiSingleDocument = {
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

  describe("authorisation metadata", () => {
    // JwtAuthGuard._validateRoles reads `roles` from the handler Nest calls; a class-level
    // @Roles is not read, so the restriction must sit on the method itself.
    const rolesOf = (method: keyof ChunkController) =>
      Reflect.getMetadata("roles", ChunkController.prototype[method] as any) as string[] | undefined;

    it("restricts POST /chunks/rebuild-all-embeddings to the platform Administrator", () => {
      expect(rolesOf("rebuildAllEmbeddings")).toEqual([RoleId.Administrator]);
    });

    it("refuses a non-admin role by metadata: CompanyAdministrator is not in the list", () => {
      expect(rolesOf("rebuildAllEmbeddings")).not.toContain(RoleId.CompanyAdministrator);
    });

    // Same job as rebuild-all: drops the global vector index and re-embeds every company's chunks.
    it("restricts POST /chunks/rebuild-embeddings to the platform Administrator", () => {
      expect(rolesOf("rebuildEmbeddings")).toEqual([RoleId.Administrator]);
      expect(rolesOf("rebuildEmbeddings")).not.toContain(RoleId.CompanyAdministrator);
    });

    it("leaves GET /chunks/:chunkId open to any authenticated user (company-filtered in the repository)", () => {
      expect(rolesOf("findById")).toBeUndefined();
    });

    it("puts the restriction on the handler, not on the class", () => {
      expect(Reflect.getMetadata("roles", ChunkController)).toBeUndefined();
    });
  });

  describe("dependency injection", () => {
    it("should have chunkService injected", () => {
      expect(controller["chunkService"]).toBeDefined();
    });
  });
});
