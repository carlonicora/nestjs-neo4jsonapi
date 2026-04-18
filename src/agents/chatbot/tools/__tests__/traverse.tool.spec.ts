import { TraverseTool } from "../traverse.tool";

describe("TraverseTool", () => {
  const accounts: any = {
    type: "accounts",
    module: "crm",
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
    module: "sales",
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
  const ctx = { companyId: "c", userId: "u", userModules: ["crm", "sales"] };
  const targetSvc = {
    findRelatedRecords: vi.fn(async () => [{ id: "o1", total: 100, createdAt: "2026-04-01" }]),
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

  it("traverses and applies target-field filter + sort", async () => {
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
      [],
    );
    expect(targetSvc.findRelatedRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        relationship: "orders",
        id: "a1",
        filters: [{ field: "total", op: "gte", value: 50 }],
        orderByFields: [{ field: "createdAt", direction: "desc" }],
        limit: 1,
      }),
    );
    expect(out.items[0]).toMatchObject({ id: "o1", type: "orders", summary: "#o1" });
  });

  it("rejects unknown relationship", async () => {
    const tool = new TraverseTool(factory);
    const out: any = await tool.invoke({ fromType: "accounts", fromId: "a1", relationship: "ghost" }, ctx, []);
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
      [],
    );
    expect(out.error).toMatch(/ghost/);
  });

  it("uses inverseKey when relationship is reverse", async () => {
    const accountsWithReverse: any = {
      type: "accounts",
      module: "crm",
      description: "A",
      fields: [],
      relationships: [
        {
          name: "orders", // reverse name
          sourceType: "accounts",
          targetType: "orders",
          cardinality: "many",
          description: "Orders placed by this account",
          cypherDirection: "in",
          cypherLabel: "FOR",
          isReverse: true,
          inverseKey: "account", // forward key on Order's side
        },
      ],
      nodeName: "account",
      labelName: "Account",
      summary: (d: any) => d.name,
    };
    const reverseTargetSvc = {
      findRelatedRecords: vi.fn(async () => [{ id: "o1", total: 100, createdAt: "2026-04-01" }]),
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
    await tool.invoke({ fromType: "accounts", fromId: "a1", relationship: "orders", limit: 1 }, ctx, []);
    expect(reverseTargetSvc.findRelatedRecords).toHaveBeenCalledWith(
      expect.objectContaining({ relationship: "account", id: "a1" }),
    );
  });
});
