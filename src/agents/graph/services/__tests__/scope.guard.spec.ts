import { describe, expect, it, vi } from "vitest";
import { ScopeGuard } from "../scope.guard";

const transcriptSegment = {
  type: "transcript-segments",
  labelName: "TranscriptSegment",
  scope: {
    rootType: "campaigns",
    rootLabel: "Campaign",
    path: [
      {
        key: "transcript",
        cypherLabel: "PART_OF",
        cypherDirection: "out",
        targetLabel: "Transcript",
        targetType: "transcripts",
      },
      {
        key: "recording",
        cypherLabel: "FROM_RECORDING",
        cypherDirection: "out",
        targetLabel: "Recording",
        targetType: "recordings",
      },
      {
        key: "campaign",
        cypherLabel: "PART_OF",
        cypherDirection: "out",
        targetLabel: "Campaign",
        targetType: "campaigns",
      },
    ],
  },
} as any;

const npcInbound = {
  type: "npcs",
  labelName: "Npc",
  scope: {
    rootType: "campaigns",
    rootLabel: "Campaign",
    path: [
      {
        key: "campaign",
        cypherLabel: "OWNS",
        cypherDirection: "in",
        targetLabel: "Campaign",
        targetType: "campaigns",
      },
    ],
  },
} as any;

const scopedCtx = { companyId: "c", userId: "u", userModuleIds: [], scopeId: "camp-1", scopeType: "campaigns" };
const unscopedCtx = { companyId: "c", userId: "u", userModuleIds: [] };

describe("ScopeGuard.buildMatchClause", () => {
  it("emits a parameterised EXISTS chain for a three-hop scope", () => {
    const guard = new ScopeGuard({ getEntityDetail: () => transcriptSegment } as any);
    const result = guard.buildMatchClause({ entity: transcriptSegment, ctx: scopedCtx, nodeAlias: "node" })!;

    expect(result.cypher.replace(/\s+/g, " ").trim()).toBe(
      "AND EXISTS { MATCH (node)-[:PART_OF]->(:Transcript)-[:FROM_RECORDING]->(:Recording)-[:PART_OF]->(:Campaign { id: $scopeId }) }",
    );
    expect(result.params).toEqual({ scopeId: "camp-1" });
    expect(result.cypher).not.toContain("camp-1");
  });

  it("reverses the arrow for an inbound hop", () => {
    const guard = new ScopeGuard({ getEntityDetail: () => npcInbound } as any);
    const result = guard.buildMatchClause({ entity: npcInbound, ctx: scopedCtx, nodeAlias: "node" })!;
    expect(result.cypher).toContain("(node)<-[:OWNS]-(:Campaign { id: $scopeId })");
  });

  it("returns null when the run is unscoped", () => {
    const guard = new ScopeGuard({ getEntityDetail: () => transcriptSegment } as any);
    expect(guard.buildMatchClause({ entity: transcriptSegment, ctx: unscopedCtx, nodeAlias: "node" })).toBeNull();
  });

  it("returns null when the entity's root type is not the run's scope type", () => {
    const guard = new ScopeGuard({ getEntityDetail: () => transcriptSegment } as any);
    const otherRoot = { ...scopedCtx, scopeType: "tenants" };
    expect(guard.buildMatchClause({ entity: transcriptSegment, ctx: otherRoot, nodeAlias: "node" })).toBeNull();
  });
});

describe("ScopeGuard.filter", () => {
  it("keeps only records the scope query returns", async () => {
    const read = vi.fn().mockResolvedValue({ records: [{ get: () => "a" }] });
    const guard = new ScopeGuard({ getEntityDetail: () => npcInbound } as any, { read } as any);

    const kept = await guard.filter({
      type: "npcs",
      records: [{ id: "a" }, { id: "b" }],
      ctx: scopedCtx,
    });

    expect(kept).toEqual([{ id: "a" }]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("passes everything through when the run is unscoped", async () => {
    const read = vi.fn();
    const guard = new ScopeGuard({ getEntityDetail: () => npcInbound } as any, { read } as any);
    const records = [{ id: "a" }, { id: "b" }];
    await expect(guard.filter({ type: "npcs", records, ctx: unscopedCtx })).resolves.toBe(records);
    expect(read).not.toHaveBeenCalled();
  });

  it("returns an empty list when the type is catalogued but unscoped in a scoped run", async () => {
    const guard = new ScopeGuard(
      { getEntityDetail: () => ({ type: "x", labelName: "X" }) } as any,
      { read: vi.fn() } as any,
    );
    await expect(guard.filter({ type: "x", records: [{ id: "a" }], ctx: scopedCtx })).resolves.toEqual([]);
  });
});
