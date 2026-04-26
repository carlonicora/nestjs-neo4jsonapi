import { vi, describe, it, expect } from "vitest";
import { SearchEntitiesTool } from "../search-entities.tool";

describe("SearchEntitiesTool", () => {
  const catalog: any = {
    getEntityDetail: (type: string) =>
      type === "accounts"
        ? {
            type: "accounts",
            moduleId: "11111111-1111-1111-1111-111111111111",
            description: "A",
            fields: [
              { name: "name", type: "string", filterable: true, sortable: true },
              { name: "status", type: "string", filterable: true, sortable: true },
            ],
            relationships: [],
            nodeName: "account",
            labelName: "Account",
            textSearchFields: ["name"],
            summary: (d: any) => d.name,
          }
        : null,
  };
  const registryGet = vi.fn();
  const ctx = { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] };
  const factory: any = {
    resolveEntity: (t: string) => catalog.getEntityDetail(t) ?? { error: "nope" },
    resolveService: (t: string) => registryGet(t),
    capture: async (_r: any, fn: any, rec: any[]) => {
      const v = await fn();
      rec.push({});
      return v;
    },
  };

  // Second argument is the search service; this tool no longer calls it,
  // so a bare spy suffices.
  const unusedSearch: any = {};

  it("rejects filter on undescribed field with explicit error", async () => {
    const tool = new SearchEntitiesTool(factory, unusedSearch, {} as any, {} as any);
    const out: any = await tool.invoke(
      { type: "accounts", filters: [{ field: "secret", op: "eq", value: "x" }] },
      ctx,
      [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }],
    );
    expect(out.error).toMatch(/secret/);
  });

  it("rejects sort on undescribed field", async () => {
    const tool = new SearchEntitiesTool(factory, unusedSearch, {} as any, {} as any);
    const out: any = await tool.invoke({ type: "accounts", sort: [{ field: "ghost", direction: "asc" }] }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.error).toMatch(/ghost/);
  });

  it("rejects `like` on number field", async () => {
    const factoryNum: any = {
      ...factory,
      resolveEntity: () => ({
        ...catalog.getEntityDetail("accounts"),
        fields: [{ name: "amount", type: "number", filterable: true, sortable: true }],
      }),
    };
    const tool = new SearchEntitiesTool(factoryNum, unusedSearch);
    const out: any = await tool.invoke(
      { type: "accounts", filters: [{ field: "amount", op: "like", value: "x" }] },
      ctx,
      [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }],
    );
    expect(out.error).toMatch(/like.*not valid/i);
  });

  it("clamps limit to [1, 50]", async () => {
    const svc = { findRecords: vi.fn(async () => []) };
    registryGet.mockReturnValue(svc);
    const tool = new SearchEntitiesTool(factory, unusedSearch, {} as any, {} as any);
    await tool.invoke({ type: "accounts", limit: 5000 }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(svc.findRecords).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it("returns matchMode='none' and per-item score=null for filter-only queries", async () => {
    const svc = { findRecords: vi.fn().mockResolvedValue([{ id: "a1", name: "foo", status: "active" }]) };
    registryGet.mockReturnValue(svc);
    const tool = new SearchEntitiesTool(factory, unusedSearch, {} as any, {} as any);
    const out: any = await tool.invoke({ type: "accounts" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);

    expect(out.matchMode).toBe("none");
    expect(out.items[0].score).toBeNull();
  });

  it("Zod schema rejects a `text` property at the build() surface", () => {
    const tool = new SearchEntitiesTool(factory, unusedSearch, {} as any, {} as any);
    const built: any = tool.build(ctx, []);
    const parsed = built.schema.safeParse({ type: "accounts", text: "Faby" });
    expect(parsed.success).toBe(false);
  });

  it("tool description does not mention name search or matchMode cascade", () => {
    const tool = new SearchEntitiesTool(factory, unusedSearch, {} as any, {} as any);
    const built: any = tool.build(ctx, []);
    expect(built.description).not.toMatch(/name/i);
    expect(built.description).not.toMatch(/matchMode/);
    expect(built.description).toMatch(/resolve_entity/);
  });

  it("materialises items when the entity is a bridge", async () => {
    const moduleId = "44444444-4444-4444-4444-444444444444";
    const items = {
      type: "items",
      moduleId,
      description: "An item.",
      fields: [{ name: "name", type: "string", description: "n", filterable: true, sortable: true }],
      relationships: [],
      nodeName: "item",
      labelName: "Item",
    };
    const bomEntries: any = {
      type: "bom-entries",
      moduleId,
      description: "Junction record.",
      fields: [{ name: "position", type: "number", description: "row", filterable: true, sortable: true }],
      relationships: [
        {
          name: "item",
          sourceType: "bom-entries",
          targetType: "items",
          cardinality: "one",
          description: "x",
          cypherDirection: "out",
          cypherLabel: "FOR_ITEM",
          isReverse: false,
        },
      ],
      nodeName: "bomEntry",
      labelName: "BomEntry",
      bridge: { materialiseTo: ["item"] },
      summary: (d: any) => `row #${d.position ?? "?"}`,
    };

    const svc = {
      findRecords: vi.fn(async () => [
        { id: "be-1", position: 1 },
        { id: "be-2", position: 2 },
      ]),
    };
    const itemEdgeSvc = {
      findRelatedRecordsByEdge: vi.fn(async (params: any) =>
        params.relatedId === "be-1" ? [{ id: "it-1", name: "A" }] : [{ id: "it-2", name: "B" }],
      ),
    };

    const bridgeFactory: any = {
      resolveEntity: (t: string) => (t === "bom-entries" ? bomEntries : items),
      resolveService: (t: string) => (t === "bom-entries" ? svc : undefined),
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const bridgeCatalog: any = { getEntityDetail: (t: string) => (t === "items" ? items : null) };
    const bridgeRegistry: any = { get: (t: string) => (t === "items" ? itemEdgeSvc : undefined) };

    const tool = new SearchEntitiesTool(bridgeFactory, unusedSearch, bridgeCatalog, bridgeRegistry);
    const out: any = await tool.invoke({ type: "bom-entries" }, { ...ctx, userModuleIds: [moduleId] }, [
      { tool: "describe_entity", input: { type: "bom-entries" }, durationMs: 0 },
    ]);

    expect(out.matchMode).toBe("none");
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({
      id: "be-1",
      type: "bom-entries",
      summary: "row #1",
      score: null,
      __materialised: ["item"],
    });
    expect(out.items[0].item).toMatchObject({ id: "it-1", type: "items" });
  });
});
