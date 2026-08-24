import { TraverseTool } from "../traverse.tool";
import { ToolFieldFormatterService } from "../../services/field-formatting";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";

describe("TraverseTool", () => {
  const formatter = new ToolFieldFormatterService(new BlockNoteService());

  const accounts: any = {
    type: "accounts",
    moduleId: "11111111-1111-1111-1111-111111111111",
    description: "A",
    fields: [{ name: "name", type: "string", filterable: true, sortable: true }],
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
    nodeName: "account",
    labelName: "Account",
    summary: (d: any) => d.name,
  };
  const orders: any = {
    type: "orders",
    moduleId: "22222222-2222-2222-2222-222222222222",
    description: "An order",
    fields: [
      { name: "total", type: "number", filterable: true, sortable: true },
      { name: "createdAt", type: "datetime", filterable: true, sortable: true },
    ],
    relationships: [],
    nodeName: "order",
    labelName: "Order",
    summary: (d: any) => `#${d.id}`,
  };
  const ctx = {
    companyId: "c",
    userId: "u",
    userModuleIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
  };
  const targetSvc = {
    findRelatedRecordsByEdge: vi.fn(async () => [{ id: "o1", total: 100, createdAt: "2026-04-01" }]),
  };
  const factory: any = {
    resolveEntity: (t: string) => (t === "accounts" ? accounts : t === "orders" ? orders : { error: "nope" }),
    resolveService: (t: string) => (t === "orders" ? targetSvc : undefined),
    capture: async (_r: any, fn: any, rec: any[]) => {
      const v = await fn();
      rec.push({});
      return v;
    },
  };

  it("traverses via catalog edge spec and applies target-field filter + sort", async () => {
    targetSvc.findRelatedRecordsByEdge.mockClear();
    const tool = new TraverseTool(factory, {} as any, {} as any, {} as any, formatter, {} as any);
    const out: any = await tool.invoke(
      {
        fromType: "accounts",
        fromId: "a1",
        relationship: "orders",
        filters: [{ field: "total", op: "gte", value: 50 }],
        sort: [{ field: "createdAt", direction: "desc" }],
        limit: 1,
      },
      ctx,
      [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }],
    );
    expect(targetSvc.findRelatedRecordsByEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        cypherLabel: "PLACED",
        cypherDirection: "in", // inverted from source-perspective "out"
        relatedLabel: "Account",
        relatedId: "a1",
        filters: [{ field: "total", op: "gte", value: 50 }],
        orderByFields: [{ field: "createdAt", direction: "desc" }],
        limit: 2, // probes one extra record beyond the requested limit of 1
      }),
    );
    expect(out.items[0]).toMatchObject({ id: "o1", type: "orders", summary: "#o1" });
  });

  it("fetches limit+1, slices to limit, and flags hasMore + note when more records exist", async () => {
    targetSvc.findRelatedRecordsByEdge.mockClear();
    targetSvc.findRelatedRecordsByEdge.mockResolvedValueOnce([
      { id: "o1", total: 100, createdAt: "2026-04-01" },
      { id: "o2", total: 200, createdAt: "2026-04-02" },
      { id: "o3", total: 300, createdAt: "2026-04-03" },
    ]);
    const tool = new TraverseTool(factory, {} as any, {} as any, {} as any, formatter, {} as any);
    const out: any = await tool.invoke({ fromType: "accounts", fromId: "a1", relationship: "orders", limit: 2 }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(targetSvc.findRelatedRecordsByEdge).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
    expect(out.items).toHaveLength(2);
    expect(out.hasMore).toBe(true);
    expect(out.note).toBe(
      'Only the first 2 matches are shown. Call this tool again with a higher "limit" (max 50) to fetch the rest.',
    );
  });

  it("omits hasMore and note when the result fits within the limit", async () => {
    targetSvc.findRelatedRecordsByEdge.mockClear();
    targetSvc.findRelatedRecordsByEdge.mockResolvedValueOnce([{ id: "o1", total: 100, createdAt: "2026-04-01" }]);
    const tool = new TraverseTool(factory, {} as any, {} as any, {} as any, formatter, {} as any);
    const out: any = await tool.invoke({ fromType: "accounts", fromId: "a1", relationship: "orders", limit: 2 }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.items).toHaveLength(1);
    expect("hasMore" in out).toBe(false);
    expect("note" in out).toBe(false);
  });

  it("rejects unknown relationship", async () => {
    const tool = new TraverseTool(factory, {} as any, {} as any, {} as any, formatter, {} as any);
    const out: any = await tool.invoke({ fromType: "accounts", fromId: "a1", relationship: "ghost" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.error).toMatch(/ghost/);
  });

  it("rejects filter on target field not described on target", async () => {
    const tool = new TraverseTool(factory, {} as any, {} as any, {} as any, formatter, {} as any);
    const out: any = await tool.invoke(
      {
        fromType: "accounts",
        fromId: "a1",
        relationship: "orders",
        filters: [{ field: "ghost", op: "eq", value: "x" }],
      },
      ctx,
      [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }],
    );
    expect(out.error).toMatch(/ghost/);
  });

  it("walks a reverse catalog relationship via the edge spec (no inverseKey required)", async () => {
    const accountsWithReverse: any = {
      type: "accounts",
      moduleId: "11111111-1111-1111-1111-111111111111",
      description: "A",
      fields: [],
      relationships: [
        {
          name: "orders", // reverse name as it appears on the account catalog
          sourceType: "accounts",
          targetType: "orders",
          cardinality: "many",
          description: "Orders placed by this account",
          cypherDirection: "in", // account sees FOR edge as incoming
          cypherLabel: "FOR",
          isReverse: true,
          inverseKey: "account",
        },
      ],
      nodeName: "account",
      labelName: "Account",
      summary: (d: any) => d.name,
    };
    const reverseTargetSvc = {
      findRelatedRecordsByEdge: vi.fn(async () => [{ id: "o1", total: 100, createdAt: "2026-04-01" }]),
    };
    const reverseFactory: any = {
      resolveEntity: (t: string) => (t === "accounts" ? accountsWithReverse : orders),
      resolveService: (t: string) => (t === "orders" ? reverseTargetSvc : undefined),
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const tool = new TraverseTool(reverseFactory, {} as any, {} as any, {} as any, formatter, {} as any);
    await tool.invoke({ fromType: "accounts", fromId: "a1", relationship: "orders", limit: 1 }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(reverseTargetSvc.findRelatedRecordsByEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        cypherLabel: "FOR",
        cypherDirection: "out", // inverted from source-perspective "in"
        relatedLabel: "Account",
        relatedId: "a1",
      }),
    );
  });

  it("materialises each item when the traversal target is a bridge", async () => {
    const moduleId = "33333333-3333-3333-3333-333333333333";
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
    const boms: any = {
      type: "boms",
      moduleId,
      description: "BoM.",
      fields: [],
      relationships: [
        {
          name: "bomEntries",
          sourceType: "boms",
          targetType: "bom-entries",
          cardinality: "many",
          description: "x",
          cypherDirection: "out",
          cypherLabel: "HAS_BOM_ENTRY",
          isReverse: false,
        },
      ],
      nodeName: "bom",
      labelName: "BoM",
    };

    const targetSvcEntries = {
      findRelatedRecordsByEdge: vi.fn(async () => [
        { id: "be-1", position: 1 },
        { id: "be-2", position: 2 },
      ]),
    };
    const itemEdgeSvc = {
      findRelatedRecordsByEdge: vi.fn(async (params: any) =>
        params.relatedId === "be-1" ? [{ id: "it-1", name: "A" }] : [{ id: "it-2", name: "B" }],
      ),
    };
    const f: any = {
      resolveEntity: (t: string) =>
        t === "boms" ? boms : t === "bom-entries" ? bomEntries : t === "items" ? items : { error: "nope" },
      resolveService: (t: string) => (t === "bom-entries" ? targetSvcEntries : undefined),
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const bridgeCatalog: any = { getEntityDetail: (t: string) => (t === "items" ? items : null) };
    const bridgeRegistry: any = { get: (t: string) => (t === "items" ? itemEdgeSvc : undefined) };

    const tool = new TraverseTool(f, bridgeCatalog, bridgeRegistry, {} as any, formatter, {} as any);
    const out: any = await tool.invoke(
      { fromType: "boms", fromId: "bom-1", relationship: "bomEntries", limit: 10 },
      { ...ctx, userModuleIds: [moduleId] },
      [{ tool: "describe_entity", input: { type: "boms" }, durationMs: 0 }],
    );

    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({
      id: "be-1",
      type: "bom-entries",
      summary: "row #1",
      __materialised: ["item"],
    });
    expect(out.items[0].item).toMatchObject({ id: "it-1", type: "items" });
    expect(out.items[1].item).toMatchObject({ id: "it-2", type: "items" });
    expect("hasMore" in out).toBe(false);
    expect("note" in out).toBe(false);

    // Bridge return site also reports truncation when more records exist.
    targetSvcEntries.findRelatedRecordsByEdge.mockResolvedValueOnce([
      { id: "be-1", position: 1 },
      { id: "be-2", position: 2 },
    ]);
    const truncated: any = await tool.invoke(
      { fromType: "boms", fromId: "bom-1", relationship: "bomEntries", limit: 1 },
      { ...ctx, userModuleIds: [moduleId] },
      [{ tool: "describe_entity", input: { type: "boms" }, durationMs: 0 }],
    );
    expect(targetSvcEntries.findRelatedRecordsByEdge).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 2 }));
    expect(truncated.items).toHaveLength(1);
    expect(truncated.items[0]).toMatchObject({ id: "be-1", __materialised: ["item"] });
    expect(truncated.hasMore).toBe(true);
    expect(truncated.note).toBe(
      'Only the first 1 matches are shown. Call this tool again with a higher "limit" (max 50) to fetch the rest.',
    );
  });

  it("walks a forward asymmetric relationship (target descriptor lacks the key)", async () => {
    // Person → Account via "account": forward, cypherDirection "out" on Person's catalog.
    // The Account descriptor does not declare "account" — edge-based lookup is required.
    const personsEntity: any = {
      type: "persons",
      moduleId: "11111111-1111-1111-1111-111111111111",
      description: "A person",
      fields: [],
      relationships: [
        {
          name: "account",
          sourceType: "persons",
          targetType: "accounts",
          cardinality: "one",
          description: "Account this person works for",
          cypherDirection: "out",
          cypherLabel: "WORKS_FOR",
          isReverse: false,
        },
      ],
      nodeName: "person",
      labelName: "Person",
      summary: (d: any) => d.name,
    };
    const accountSvc = {
      findRelatedRecordsByEdge: vi.fn(async () => [{ id: "a1", name: "Acme" }]),
    };
    const f: any = {
      resolveEntity: (t: string) =>
        t === "persons"
          ? personsEntity
          : t === "accounts"
            ? { ...accounts, relationships: [] } // no keys needed on Account side
            : { error: "nope" },
      resolveService: (t: string) => (t === "accounts" ? accountSvc : undefined),
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const tool = new TraverseTool(f, {} as any, {} as any, {} as any, formatter, {} as any);
    await tool.invoke({ fromType: "persons", fromId: "p1", relationship: "account", limit: 1 }, ctx, [
      { tool: "describe_entity", input: { type: "persons" }, durationMs: 0 },
    ]);
    expect(accountSvc.findRelatedRecordsByEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        cypherLabel: "WORKS_FOR",
        cypherDirection: "in", // inverted from "out"
        relatedLabel: "Person",
        relatedId: "p1",
      }),
    );
  });

  it("stages list projection: short fields inline, long field name withheld to availableOnRead", async () => {
    const longBody = "x".repeat(250);
    const notes: any = {
      type: "notes",
      moduleId: "44444444-4444-4444-4444-444444444444",
      description: "A note.",
      fields: [
        { name: "title", type: "string", description: "t", filterable: true, sortable: true },
        { name: "body", type: "string", description: "b", filterable: true, sortable: true },
      ],
      relationships: [],
      nodeName: "note",
      labelName: "Note",
      summary: (d: any) => d.title,
    };
    const stagedSource: any = {
      ...accounts,
      relationships: [
        {
          name: "notes",
          targetType: "notes",
          cardinality: "many",
          description: "x",
          cypherDirection: "out",
          cypherLabel: "HAS_NOTE",
          isReverse: false,
          sourceType: "accounts",
        },
      ],
    };
    const notesSvc = {
      findRelatedRecordsByEdge: vi.fn(async () => [{ id: "n1", title: "Short", body: longBody }]),
    };
    const stagedFactory: any = {
      resolveEntity: (t: string) => (t === "accounts" ? stagedSource : t === "notes" ? notes : { error: "nope" }),
      resolveService: (t: string) => (t === "notes" ? notesSvc : undefined),
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const tool = new TraverseTool(stagedFactory, {} as any, {} as any, {} as any, formatter, {} as any);
    const out: any = await tool.invoke({ fromType: "accounts", fromId: "a1", relationship: "notes" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.items[0].fields.title).toBe("Short");
    expect(out.items[0].fields.body).toBeUndefined();
    expect(out.items[0].availableOnRead).toEqual(["body"]);
  });
});

describe("TraverseTool — polymorphic related traversal", () => {
  const formatter = new ToolFieldFormatterService(new BlockNoteService());
  const MODULE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const MODULE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const MODULE_GATED = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  const RELATED_REL = {
    name: "related",
    sourceType: "things",
    targetType: "*",
    cardinality: "many",
    description: "Records linked to this one by mentions or GM-drawn links. Results carry their own type.",
    cypherDirection: "out",
    cypherLabel: "RELATES_TO",
    isReverse: false,
    polymorphic: true,
  };

  const things: any = {
    type: "things",
    moduleId: MODULE_A,
    description: "A thing.",
    fields: [{ name: "name", type: "string", description: "n", filterable: true, sortable: true }],
    relationships: [
      RELATED_REL,
      {
        name: "alphas",
        sourceType: "things",
        targetType: "alphas",
        cardinality: "many",
        description: "typed",
        cypherDirection: "out",
        cypherLabel: "HAS_ALPHA",
        isReverse: false,
      },
    ],
    nodeName: "thing",
    labelName: "Thing",
    summary: (d: any) => d.name,
  };
  const alphas: any = {
    type: "alphas",
    moduleId: MODULE_A,
    description: "An alpha.",
    fields: [
      { name: "title", type: "string", description: "t", filterable: true, sortable: true },
      { name: "body", type: "string", description: "b", filterable: true, sortable: true },
    ],
    relationships: [],
    nodeName: "alpha",
    labelName: "Alpha",
    summary: (d: any) => `alpha:${d.title}`,
  };
  const betas: any = {
    type: "betas",
    moduleId: MODULE_B,
    description: "A beta.",
    fields: [{ name: "label", type: "string", description: "l", filterable: true, sortable: true }],
    relationships: [],
    nodeName: "beta",
    labelName: "Beta",
    summary: (d: any) => `beta:${d.label}`,
  };
  const gammas: any = {
    type: "gammas",
    moduleId: MODULE_GATED,
    description: "A gated gamma.",
    fields: [{ name: "label", type: "string", description: "l", filterable: true, sortable: true }],
    relationships: [],
    nodeName: "gamma",
    labelName: "Gamma",
    summary: (d: any) => `gamma:${d.label}`,
  };

  const ctx: any = { companyId: "c", userId: "u", userModuleIds: [MODULE_A, MODULE_B] };
  const describedRecorder = () => [{ tool: "describe_entity", input: { type: "things" }, durationMs: 0 }] as any[];

  const catalog: any = { getAllEntities: () => [things, alphas, betas, gammas] };

  function build(opts: {
    pairs: { id: string; label: string }[];
    records?: Record<string, any>;
    sourceRecord?: any;
    scopeGuard?: any;
    gatedTypes?: string[];
  }) {
    const entities: Record<string, any> = { things, alphas, betas, gammas };
    const gated = new Set(opts.gatedTypes ?? ["gammas"]);
    const records = opts.records ?? {
      a1: { id: "a1", title: "Alpha one", body: "short" },
      a2: { id: "a2", title: "Alpha two", body: "short" },
      b1: { id: "b1", label: "Beta one" },
    };
    const svcFor = (type: string) => ({
      findRecordById: vi.fn(async (p: { id: string }) => records[p.id] ?? null),
      findRelatedRecordsByEdge: vi.fn(async () => [{ id: "a1", title: "Alpha one", body: "short" }]),
      __type: type,
    });
    const services: Record<string, any> = {
      things: {
        findRecordById: vi.fn(async () =>
          opts.sourceRecord === undefined ? { id: "id1", name: "Thing" } : opts.sourceRecord,
        ),
        findRelatedRecordsByEdge: vi.fn(async () => [{ id: "a1", title: "Alpha one", body: "short" }]),
      },
      alphas: svcFor("alphas"),
      betas: svcFor("betas"),
      gammas: svcFor("gammas"),
    };
    const factory: any = {
      resolveEntity: (t: string) =>
        gated.has(t) ? { error: `Entity type "${t}" is not available.` } : (entities[t] ?? { error: "nope" }),
      resolveService: (t: string) => services[t],
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const relatedEdges: any = { findRelatedIds: vi.fn(async () => opts.pairs) };
    const tool = new TraverseTool(factory, catalog, {} as any, opts.scopeGuard ?? ({} as any), formatter, relatedEdges);
    return { tool, relatedEdges, services, factory };
  }

  it("returns mixed-type items each projected with its own type's stage-1 fields", async () => {
    const longBody = "x".repeat(250);
    const { tool, relatedEdges } = build({
      pairs: [
        { id: "a1", label: "Alpha" },
        { id: "b1", label: "Beta" },
      ],
      records: {
        a1: { id: "a1", title: "Alpha one", body: longBody },
        b1: { id: "b1", label: "Beta one" },
      },
    });
    const out: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "related", limit: 10 },
      ctx,
      describedRecorder(),
    );
    expect(relatedEdges.findRelatedIds).toHaveBeenCalledWith({
      labelName: "Thing",
      id: "id1",
      cypherLabel: "RELATES_TO",
      limit: 11,
    });
    expect(out.items).toHaveLength(2);
    const alpha = out.items.find((i: any) => i.id === "a1");
    const beta = out.items.find((i: any) => i.id === "b1");
    expect(alpha).toMatchObject({ type: "alphas", summary: "alpha:Alpha one" });
    expect(alpha.fields.title).toBe("Alpha one");
    expect(alpha.fields.body).toBeUndefined();
    expect(alpha.availableOnRead).toEqual(["body"]);
    expect(beta).toMatchObject({ type: "betas", summary: "beta:Beta one" });
    expect(beta.fields.label).toBe("Beta one");
    expect("availableOnRead" in beta).toBe(false);
  });

  it("dedupes targets linked in both directions", async () => {
    const { tool } = build({
      pairs: [
        { id: "a1", label: "Alpha" },
        { id: "a1", label: "Alpha" },
      ],
    });
    const out: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "related", limit: 10 },
      ctx,
      describedRecorder(),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("a1");
  });

  it("drops targets whose label is unknown to the catalog", async () => {
    const { tool } = build({
      pairs: [
        { id: "a1", label: "Alpha" },
        { id: "z1", label: "Ghost" },
      ],
    });
    const out: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "related", limit: 10 },
      ctx,
      describedRecorder(),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("a1");
  });

  it("drops targets whose module the user cannot access", async () => {
    const { tool, services } = build({
      pairs: [
        { id: "a1", label: "Alpha" },
        { id: "g1", label: "Gamma" },
      ],
    });
    const out: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "related", limit: 10 },
      ctx,
      describedRecorder(),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("a1");
    // The gated type is never read at all.
    expect(services.gammas.findRecordById).not.toHaveBeenCalled();
  });

  it("drops out-of-scope targets via ScopeGuard", async () => {
    const scopeGuard = {
      filter: vi.fn(async (p: { type: string; records: any[] }) => (p.type === "betas" ? [] : p.records)),
    };
    const { tool } = build({
      pairs: [
        { id: "a1", label: "Alpha" },
        { id: "b1", label: "Beta" },
      ],
      scopeGuard,
    });
    const out: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "related", limit: 10 },
      { ...ctx, scopeId: "camp-1", scopeType: "campaigns" },
      describedRecorder(),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("a1");
    expect(scopeGuard.filter).toHaveBeenCalled();
  });

  it("refuses filters and sort with an explanatory error", async () => {
    const { tool, relatedEdges } = build({ pairs: [{ id: "a1", label: "Alpha" }] });
    const res: any = await tool.invoke(
      {
        fromType: "things",
        fromId: "id1",
        relationship: "related",
        filters: [{ field: "name", op: "eq", value: "x" }],
      },
      ctx,
      describedRecorder(),
    );
    expect(res.error).toMatch(/typed per-target/);
    expect(relatedEdges.findRelatedIds).not.toHaveBeenCalled();

    const sorted: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "related", sort: [{ field: "name", direction: "asc" }] },
      ctx,
      describedRecorder(),
    );
    expect(sorted.error).toMatch(/typed per-target/);
  });

  it("returns the byte-identical not-found error for a missing source record", async () => {
    const { tool, relatedEdges } = build({ pairs: [{ id: "a1", label: "Alpha" }], sourceRecord: null });
    const out: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "related" },
      ctx,
      describedRecorder(),
    );
    // Byte-identical to ReadEntityTool's missing-record message.
    expect(out.error).toBe("No things with id id1.");
    expect(relatedEdges.findRelatedIds).not.toHaveBeenCalled();
  });

  it("emits the truncation note past limit", async () => {
    const { tool, relatedEdges } = build({
      pairs: [
        { id: "a1", label: "Alpha" },
        { id: "a2", label: "Alpha" },
      ],
    });
    const out: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "related", limit: 1 },
      ctx,
      describedRecorder(),
    );
    expect(relatedEdges.findRelatedIds).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
    expect(out.items).toHaveLength(1);
    expect(out.hasMore).toBe(true);
    expect(out.note).toBe(
      'Only the first 1 matches are shown. Call this tool again with a higher "limit" (max 50) to fetch the rest.',
    );
  });

  it("leaves typed relationships on the existing path (regression)", async () => {
    const { tool, relatedEdges, services } = build({ pairs: [] });
    const out: any = await tool.invoke(
      { fromType: "things", fromId: "id1", relationship: "alphas", limit: 5 },
      ctx,
      describedRecorder(),
    );
    expect(relatedEdges.findRelatedIds).not.toHaveBeenCalled();
    expect(services.alphas.findRelatedRecordsByEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        cypherLabel: "HAS_ALPHA",
        cypherDirection: "in",
        relatedLabel: "Thing",
        relatedId: "id1",
      }),
    );
    expect(out.items[0]).toMatchObject({ id: "a1", type: "alphas" });
  });
});
