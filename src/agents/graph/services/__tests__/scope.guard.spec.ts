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

const userInline = {
  type: "users",
  labelName: "User",
  scope: {
    rootType: "proceedings",
    rootLabel: "Proceeding",
    path: [
      {
        key: "",
        dtoKey: "",
        cypherLabel: "WORKS_ON|OWNS_PROCEEDING",
        cypherDirection: "out",
        targetLabel: "Proceeding",
        targetType: "proceedings",
        inline: true,
      },
    ],
  },
} as any;

const sharedLaw = { type: "laws", labelName: "Law", scopeShared: true } as any;

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

  it("emits an alternation for an inline out hop", () => {
    const guard = new ScopeGuard({ getEntityDetail: () => userInline } as any);
    const ctx = { ...scopedCtx, scopeId: "p-1", scopeType: "proceedings" };
    const result = guard.buildMatchClause({ entity: userInline, ctx, nodeAlias: "node" })!;
    expect(result.cypher).toContain("-[:WORKS_ON|OWNS_PROCEEDING]->(:Proceeding { id: $scopeId })");
    expect(result.params).toEqual({ scopeId: "p-1" });
  });

  it("returns an empty clause (no constraint) for a scopeShared entity in a scoped run", () => {
    const guard = new ScopeGuard({ getEntityDetail: () => sharedLaw } as any);
    expect(guard.buildMatchClause({ entity: sharedLaw, ctx: scopedCtx, nodeAlias: "node" })).toEqual({
      cypher: "",
      params: {},
    });
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

  it("keeps every record of a scopeShared type without querying", async () => {
    const read = vi.fn();
    const guard = new ScopeGuard({ getEntityDetail: () => sharedLaw } as any, { read } as any);
    const records = [{ id: "a" }, { id: "b" }];
    await expect(guard.filter({ type: "laws", records, ctx: scopedCtx })).resolves.toEqual(records);
    expect(read).not.toHaveBeenCalled();
  });

  it("isInScope passes a scopeShared type through", async () => {
    const read = vi.fn();
    const guard = new ScopeGuard({ getEntityDetail: () => sharedLaw } as any, { read } as any);
    await expect(guard.isInScope({ type: "laws", id: "a", ctx: scopedCtx })).resolves.toBe(true);
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

describe("ScopeGuard on a viaService type", () => {
  const massima = {
    type: "massime",
    labelName: "Massima",
    scope: { rootType: "campaigns", rootLabel: "Campaign", path: [], viaService: true },
  } as any;

  it("filter on a viaService type delegates to the service's filterInScope", async () => {
    const read = vi.fn();
    const filterInScope = vi.fn(async () => ["c", "a"]);
    const registry = { get: vi.fn(() => ({ filterInScope })) };
    const guard = new ScopeGuard({ getEntityDetail: () => massima } as any, { read } as any, registry as any);

    const kept = await guard.filter({
      type: "massime",
      records: [{ id: "a" }, { id: "b" }, { id: "c" }],
      ctx: scopedCtx,
    });

    expect(filterInScope).toHaveBeenCalledWith({ ids: ["a", "b", "c"], scopeType: "campaigns", scopeId: "camp-1" });
    expect(registry.get).toHaveBeenCalledWith("massime");
    // Only the returned ids, in the INPUT order.
    expect(kept).toEqual([{ id: "a" }, { id: "c" }]);
    expect(read).not.toHaveBeenCalled();
  });

  it("filter on a viaService type whose service lacks filterInScope returns []", async () => {
    const read = vi.fn();
    const registry = { get: vi.fn(() => ({ findRecordById: vi.fn() })) };
    const guard = new ScopeGuard({ getEntityDetail: () => massima } as any, { read } as any, registry as any);

    await expect(guard.filter({ type: "massime", records: [{ id: "a" }], ctx: scopedCtx })).resolves.toEqual([]);
    await expect(guard.isInScope({ type: "massime", id: "a", ctx: scopedCtx })).resolves.toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("buildMatchClause returns null for a viaService type in a scoped run", () => {
    const guard = new ScopeGuard({ getEntityDetail: () => massima } as any);
    expect(guard.buildMatchClause({ entity: massima, ctx: scopedCtx, nodeAlias: "node" })).toBeNull();
  });
});
