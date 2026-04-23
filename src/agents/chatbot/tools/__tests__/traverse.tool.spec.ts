import { TraverseTool } from "../traverse.tool";

describe("TraverseTool", () => {
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
  const ctx = { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"] };
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
    const tool = new TraverseTool(factory);
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
        limit: 1,
      }),
    );
    expect(out.items[0]).toMatchObject({ id: "o1", type: "orders", summary: "#o1" });
  });

  it("rejects unknown relationship", async () => {
    const tool = new TraverseTool(factory);
    const out: any = await tool.invoke({ fromType: "accounts", fromId: "a1", relationship: "ghost" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.error).toMatch(/ghost/);
  });

  it("rejects filter on target field not described on target", async () => {
    const tool = new TraverseTool(factory);
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
    const tool = new TraverseTool(reverseFactory);
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
    const tool = new TraverseTool(f);
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
});
