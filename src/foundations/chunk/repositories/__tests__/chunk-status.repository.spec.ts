import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiStatus } from "../../../../common/enums/ai.status";
import { ChunkDescriptor } from "../../entities/chunk.entity";
import { ChunkStatusRepository } from "../chunk-status.repository";

describe("ChunkStatusRepository", () => {
  let repository: ChunkStatusRepository;
  let neo4j: {
    initQuery: ReturnType<typeof vi.fn>;
    readMany: ReturnType<typeof vi.fn>;
    writeOne: ReturnType<typeof vi.fn>;
    bindsRequestContext: boolean;
  };

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn(() => ({
        query: "MATCH (company:Company {id: $companyId})",
        queryParams: { companyId: "co-1", currentUserId: "u-1" },
      })),
      readMany: vi.fn().mockResolvedValue([]),
      writeOne: vi.fn().mockResolvedValue(undefined),
      bindsRequestContext: true,
    };
    const securityService = { userHasAccess: (p: { validator: () => string }) => p.validator() };
    const clsService = { get: vi.fn(), has: vi.fn().mockReturnValue(true) };
    repository = new ChunkStatusRepository(neo4j as any, securityService as any, clsService as any);
  });

  describe("markNotGraphed", () => {
    it("sets NotGraphed on the given chunks, joined through their owner to the CLS company", async () => {
      await repository.markNotGraphed({ ids: ["ch-1", "ch-2"] });

      expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: ChunkDescriptor.model });
      const query = neo4j.writeOne.mock.calls[0][0];
      expect(query.query).toContain("MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(owner)-[:BELONGS_TO]->(company)");
      expect(query.query).toContain("chunk.id IN $ids");
      expect(query.query).not.toMatch(/\(chunk[^)]*\)-\[:BELONGS_TO\]/);
      expect(query.queryParams).toEqual(
        expect.objectContaining({ companyId: "co-1", ids: ["ch-1", "ch-2"], aiStatus: AiStatus.NotGraphed }),
      );
    });

    it("does not query when there are no ids", async () => {
      await repository.markNotGraphed({ ids: [] });
      expect(neo4j.writeOne).not.toHaveBeenCalled();
    });
  });

  describe("findByStatusForContent", () => {
    it("reads the chunks of the given owners in the given statuses, joined to the CLS company", async () => {
      const chunks = [{ id: "ch-1" }];
      neo4j.readMany.mockResolvedValue(chunks);

      const result = await repository.findByStatusForContent({
        contentIds: ["npc-1", "loc-1"],
        aiStatus: [AiStatus.NotGraphed],
      });

      expect(result).toBe(chunks);
      expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: ChunkDescriptor.model });
      const query = neo4j.readMany.mock.calls[0][0];
      expect(query.query).toContain("MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(owner)-[:BELONGS_TO]->(company)");
      expect(query.query).toContain("owner.id IN $contentIds");
      expect(query.query).toContain("chunk.aiStatus IN $aiStatus");
      expect(query.query).not.toMatch(/\(chunk[^)]*\)-\[:BELONGS_TO\]/);
      expect(query.queryParams).toEqual(
        expect.objectContaining({ companyId: "co-1", contentIds: ["npc-1", "loc-1"], aiStatus: ["not_graphed"] }),
      );
    });

    it("returns an empty list without querying when there are no content ids", async () => {
      const result = await repository.findByStatusForContent({ contentIds: [], aiStatus: [AiStatus.NotGraphed] });
      expect(result).toEqual([]);
      expect(neo4j.readMany).not.toHaveBeenCalled();
    });
  });

  it("creates no schema of its own: ChunkRepository owns the Chunk constraints and indexes", async () => {
    await repository.onModuleInit();
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });
});
