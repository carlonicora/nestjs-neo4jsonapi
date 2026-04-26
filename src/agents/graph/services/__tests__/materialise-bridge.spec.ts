import { describe, it, expect, vi } from "vitest";
import { materialiseBridge, MATERIALISE_LIMIT } from "../materialise-bridge";

const moduleId = "mod-1";

function makeBridgeEntity(overrides: any = {}) {
  return {
    type: "bom-entries",
    moduleId,
    description: "junction",
    fields: [{ name: "position", type: "number", description: "row", filterable: true, sortable: true }],
    relationships: [
      {
        name: "item",
        sourceType: "bom-entries",
        targetType: "items",
        cardinality: "one",
        description: "rel",
        cypherDirection: "out",
        cypherLabel: "FOR_ITEM",
        isReverse: false,
      },
      {
        name: "parts",
        sourceType: "bom-entries",
        targetType: "parts",
        cardinality: "many",
        description: "rel",
        cypherDirection: "in",
        cypherLabel: "ASSIGNED_TO",
        isReverse: true,
      },
    ],
    nodeName: "bomEntry",
    labelName: "BomEntry",
    bridge: { materialiseTo: ["item", "parts"] },
    summary: (d: any) => `row #${d.position ?? "?"}`,
    ...overrides,
  };
}

const itemEntity = {
  type: "items",
  moduleId,
  description: "item",
  fields: [{ name: "name", type: "string", description: "n", filterable: true, sortable: true }],
  relationships: [],
  nodeName: "item",
  labelName: "Item",
};

const partsEntity = {
  type: "parts",
  moduleId,
  description: "part",
  fields: [{ name: "serial", type: "string", description: "s", filterable: true, sortable: true }],
  relationships: [],
  nodeName: "part",
  labelName: "Part",
};

function deps(opts: { itemRecord?: any; partsRecords?: any[]; suppress?: string[] } = {}) {
  const catalog = {
    getEntityDetail: (type: string, _modules: string[]) => {
      if (opts.suppress?.includes(type)) return null;
      if (type === "items") return itemEntity;
      if (type === "parts") return partsEntity;
      return null;
    },
  } as any;
  const registry = {
    get: (type: string) => ({
      findRelatedRecordsByEdge: vi
        .fn()
        .mockResolvedValue(
          type === "items"
            ? opts.itemRecord
              ? [opts.itemRecord]
              : []
            : type === "parts"
              ? (opts.partsRecords ?? [])
              : [],
        ),
    }),
  } as any;
  return { catalog, registry };
}

describe("materialiseBridge", () => {
  const ctx = { companyId: "c", userId: "u", userModuleIds: [moduleId] };

  it("inlines a one-cardinality and a many-cardinality target", async () => {
    const out = await materialiseBridge({
      bridge: makeBridgeEntity() as any,
      record: { id: "be-1", fields: { position: 1 } },
      ctx,
      deps: deps({
        itemRecord: { id: "it-1", name: "InstA" },
        partsRecords: [{ id: "pt-1", serial: "SN-1" }],
      }),
    });
    expect(out.id).toBe("be-1");
    expect(out.summary).toBe("row #1");
    expect((out as any).item).toMatchObject({ id: "it-1", type: "items" });
    expect((out as any).parts).toEqual([expect.objectContaining({ id: "pt-1", type: "parts" })]);
    expect(out.__materialised).toEqual(["item", "parts"]);
    expect(out.__truncated).toBeUndefined();
  });

  it("omits a relationship whose target module is not accessible", async () => {
    const out = await materialiseBridge({
      bridge: makeBridgeEntity() as any,
      record: { id: "be-1", fields: { position: 1 } },
      ctx,
      deps: deps({
        suppress: ["items"],
        partsRecords: [{ id: "pt-1", serial: "SN-1" }],
      }),
    });
    expect((out as any).item).toBeUndefined();
    expect(out.__materialised).toEqual(["parts"]);
  });

  it("truncates a many-cardinality target above MATERIALISE_LIMIT", async () => {
    const partsRecords = Array.from({ length: MATERIALISE_LIMIT + 5 }, (_, i) => ({
      id: `pt-${i}`,
      serial: `SN-${i}`,
    }));
    const out = await materialiseBridge({
      bridge: makeBridgeEntity() as any,
      record: { id: "be-1", fields: { position: 1 } },
      ctx,
      deps: deps({ itemRecord: { id: "it", name: "x" }, partsRecords }),
    });
    expect(((out as any).parts as unknown[]).length).toBe(MATERIALISE_LIMIT);
    expect(out.__truncated).toEqual({ parts: { returned: MATERIALISE_LIMIT, hasMore: true } });
  });

  it("invokes onMaterialised once per filled relationship", async () => {
    const onMaterialised = vi.fn();
    await materialiseBridge({
      bridge: makeBridgeEntity() as any,
      record: { id: "be-1", fields: { position: 1 } },
      ctx,
      deps: deps({
        itemRecord: { id: "it-1", name: "x" },
        partsRecords: [{ id: "pt-1", serial: "y" }],
      }),
      onMaterialised,
    });
    expect(onMaterialised).toHaveBeenCalledTimes(2);
  });
});
