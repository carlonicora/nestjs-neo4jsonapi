import { ReadEntityTool } from "../read-entity.tool";

describe("ReadEntityTool", () => {
  const accounts = {
    type: "accounts",
    moduleId: "11111111-1111-1111-1111-111111111111",
    description: "A",
    fields: [{ name: "name", type: "string" }],
    nodeName: "account",
    labelName: "Account",
    relationships: [
      {
        name: "orders",
        targetType: "orders",
        cardinality: "many",
        description: "x",
        cypherDirection: "out",
        cypherLabel: "PLACED",
        isReverse: false,
        sourceType: "accounts",
      },
    ],
    summary: (d: any) => d.name,
  };
  const ctx = {
    companyId: "c",
    userId: "u",
    userModuleIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
  };
  const svc = { findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })) };
  const factory: any = {
    resolveEntity: (t: string) => (t === "accounts" ? accounts : { error: "nope" }),
    resolveService: () => svc,
    capture: async (_r: any, fn: any, rec: any[]) => {
      const v = await fn();
      rec.push({});
      return v;
    },
  };

  // Minimal stand-in for ToolFieldFormatterService: projects each described
  // field straight off the record, mirroring the old buildToolFieldsOutput
  // default behaviour closely enough for these fixtures.
  const formatter: any = {
    build: ({ entity, record }: any) => {
      const fields: Record<string, unknown> = {};
      for (const f of entity.fields) fields[f.name] = record[f.name];
      return { fields };
    },
  };

  it("reads entity by id and returns described fields only", async () => {
    const tool = new ReadEntityTool(factory, {} as any, {} as any, undefined as any, formatter);
    const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out).toMatchObject({ id: "a1", type: "accounts", fields: { name: "Acme" } });
  });

  it("rejects include for undescribed relationship", async () => {
    const tool = new ReadEntityTool(factory, {} as any, {} as any, undefined as any, formatter);
    const out: any = await tool.invoke({ type: "accounts", id: "a1", include: ["ghost"] }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.error).toMatch(/ghost/);
  });

  it("materialises a bridge entity into a flat payload with __materialised", async () => {
    const moduleId = "11111111-1111-1111-1111-111111111111";
    const items = {
      type: "items",
      moduleId,
      description: "An item.",
      fields: [{ name: "name", type: "string", description: "n", filterable: true, sortable: true }],
      relationships: [],
      nodeName: "item",
      labelName: "Item",
    };
    const bomEntries = {
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

    const bridgeFactory: any = {
      resolveEntity: (t: string) => (t === "bom-entries" ? bomEntries : { error: "nope" }),
      resolveService: () => ({ findRecordById: vi.fn(async () => ({ id: "be-1", position: 1 })) }),
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const bridgeCatalog: any = {
      getEntityDetail: (t: string, _m: string[]) => (t === "items" ? items : null),
    };
    const bridgeRegistry: any = {
      get: (t: string) =>
        t === "items"
          ? { findRelatedRecordsByEdge: vi.fn(async () => [{ id: "it-1", name: "InstallationTypeA" }]) }
          : undefined,
    };

    const tool = new ReadEntityTool(bridgeFactory, bridgeCatalog, bridgeRegistry, undefined as any, formatter);
    const out: any = await tool.invoke({ type: "bom-entries", id: "be-1" }, { ...ctx, userModuleIds: [moduleId] }, [
      { tool: "describe_entity", input: { type: "bom-entries" }, durationMs: 0 },
    ]);

    expect(out.id).toBe("be-1");
    expect(out.type).toBe("bom-entries");
    expect(out.summary).toBe("row #1");
    expect(out.fields).toEqual({ position: 1 });
    expect(out.item).toMatchObject({ id: "it-1", type: "items" });
    expect(out.__materialised).toEqual(["item"]);
  });

  describe("read_entity dedup (per-pass)", () => {
    const buildAccountsFactory = (recordOrNull: unknown = { id: "a1", name: "Acme" }) => {
      const localSvc = { findRecordById: vi.fn(async () => recordOrNull) };
      const localFactory: any = {
        resolveEntity: (t: string) => (t === "accounts" ? accounts : { error: "nope" }),
        resolveService: () => localSvc,
        capture: async (_r: any, fn: any, rec: any[]) => {
          const v = await fn();
          rec.push({});
          return v;
        },
      };
      return { factory: localFactory, svc: localSvc };
    };

    it("returns the alreadyRead notice on a second read of the same (type,id) in one pass", async () => {
      const { factory: f, svc: s } = buildAccountsFactory();
      const tool = new ReadEntityTool(f, {} as any, {} as any, undefined as any, formatter);
      const readIds = new Set<string>();
      const recorder: any[] = [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }];

      const first: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, recorder, readIds);
      expect(first).toMatchObject({ id: "a1", type: "accounts", fields: { name: "Acme" } });

      const second: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, recorder, readIds);
      expect(second).toEqual({
        alreadyRead: true,
        note: expect.stringContaining("already returned in full"),
      });

      expect(s.findRecordById).toHaveBeenCalledTimes(1);
    });

    it("allows a re-read after the dedup set is cleared (retry pass)", async () => {
      const { factory: f, svc: s } = buildAccountsFactory();
      const tool = new ReadEntityTool(f, {} as any, {} as any, undefined as any, formatter);
      const readIds = new Set<string>();
      const recorder: any[] = [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }];

      const first: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, recorder, readIds);
      expect(first).toMatchObject({ id: "a1", type: "accounts" });

      readIds.clear();

      const second: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, recorder, readIds);
      expect(second).toMatchObject({ id: "a1", type: "accounts" });

      expect(s.findRecordById).toHaveBeenCalledTimes(2);
    });

    it("does not arm dedup on a failed read", async () => {
      const { factory: f, svc: s } = buildAccountsFactory(null);
      const tool = new ReadEntityTool(f, {} as any, {} as any, undefined as any, formatter);
      const readIds = new Set<string>();
      const recorder: any[] = [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }];

      const first: any = await tool.invoke({ type: "accounts", id: "missing" }, ctx, recorder, readIds);
      expect(first.error).toMatch(/No accounts with id missing/);

      const second: any = await tool.invoke({ type: "accounts", id: "missing" }, ctx, recorder, readIds);
      expect(second.error).toMatch(/No accounts with id missing/);

      expect(s.findRecordById).toHaveBeenCalledTimes(2);
    });
  });

  it("renders richtext fields to markdown in detail stage", async () => {
    const richAccounts = {
      ...accounts,
      fields: [
        { name: "name", type: "string" },
        { name: "description", type: "string", kind: { type: "richtext" as const } },
      ],
    };
    const richSvc = {
      findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme", description: "<blocknote-json>" })),
    };
    const richFactory: any = {
      resolveEntity: (t: string) => (t === "accounts" ? richAccounts : { error: "nope" }),
      resolveService: () => richSvc,
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const richFormatter: any = {
      build: vi.fn(() => ({ fields: { name: "Acme", description: "**Bold** markdown" } })),
    };

    const tool = new ReadEntityTool(richFactory, {} as any, {} as any, undefined as any, richFormatter);
    const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);

    expect(richFormatter.build).toHaveBeenCalledWith({
      entity: richAccounts,
      record: { id: "a1", name: "Acme", description: "<blocknote-json>" },
      stage: "detail",
    });
    expect(out.fields.description).toBe("**Bold** markdown");
    expect(out.availableOnRead).toBeUndefined();
  });
});
