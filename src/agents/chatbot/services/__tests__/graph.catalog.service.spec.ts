import { GraphCatalogService } from "../graph.catalog.service";

function descriptor(opts: Partial<any>): any {
  return {
    model: { type: opts.type, nodeName: opts.type, labelName: opts.type },
    description: opts.description,
    module: opts.module,
    fields: opts.fields ?? {},
    relationships: opts.relationships ?? {},
    chat: opts.chat,
  };
}

describe("GraphCatalogService", () => {
  const account = descriptor({
    type: "accounts",
    module: "crm",
    description: "A customer or supplier.",
    fields: {
      name: { type: "string", description: "Display name." },
      secret: { type: "string" }, // no description → invisible
    },
    relationships: {
      orders: {
        model: { type: "orders", nodeName: "order", labelName: "Order" },
        direction: "out",
        relationship: "PLACED",
        cardinality: "many",
        description: "Sales orders placed by this account.",
        reverse: { name: "account", description: "The account that placed this order." },
      },
    },
  });

  const order = descriptor({
    type: "orders",
    module: "sales",
    description: "A sales order.",
    fields: { total: { type: "number", description: "Total value in EUR." } },
    relationships: {},
  });

  const undescribedWidget = descriptor({
    type: "widgets",
    module: "crm",
    // no description → invisible
    fields: { name: { type: "string", description: "Display name." } },
  });

  const loadAll = () => [account, order, undescribedWidget];

  it("skips entities without a top-level description", () => {
    const svc = new GraphCatalogService({ loadAll } as any);
    svc.buildCatalog();
    expect(svc.hasType("widgets")).toBe(false);
    expect(svc.hasType("accounts")).toBe(true);
  });

  it("materialises reverse relationships on the target entity", () => {
    const svc = new GraphCatalogService({ loadAll } as any);
    svc.buildCatalog();
    const orderDetail = svc.getEntityDetail("orders", ["crm", "sales"]);
    expect(orderDetail?.relationships.map((r) => r.name)).toContain("account");
    const reverse = orderDetail!.relationships.find((r) => r.name === "account");
    expect(reverse?.isReverse).toBe(true);
    expect(reverse?.cypherDirection).toBe("in");
    expect(reverse?.inverseKey).toBe("orders");
  });

  it("drops fields that have no description", () => {
    const svc = new GraphCatalogService({ loadAll } as any);
    svc.buildCatalog();
    const accountDetail = svc.getEntityDetail("accounts", ["crm", "sales"]);
    expect(accountDetail?.fields.map((f) => f.name)).toEqual(["name"]);
  });

  it("getMapFor only includes entities in the user's modules", () => {
    const svc = new GraphCatalogService({ loadAll } as any);
    svc.buildCatalog();
    const map = svc.getMapFor(["crm"]);
    expect(map).toContain("accounts");
    expect(map).not.toContain("orders"); // sales module not enabled
  });

  it("getMapFor drops relationship lines whose target is in an inaccessible module", () => {
    const svc = new GraphCatalogService({ loadAll } as any);
    svc.buildCatalog();
    const map = svc.getMapFor(["crm"]);
    // The account.orders relationship target is 'orders' (sales module); line must be dropped.
    expect(map).not.toContain("account.orders");
  });

  it("throws on reverse-name collision at build time", () => {
    const a = descriptor({
      type: "a",
      module: "m",
      description: "A",
      fields: {},
      relationships: {
        self: {
          model: { type: "b", nodeName: "b", labelName: "B" },
          direction: "out",
          relationship: "R",
          cardinality: "one",
          description: "x",
          reverse: { name: "parent", description: "x" },
        },
      },
    });
    const c = descriptor({
      type: "c",
      module: "m",
      description: "C",
      fields: {},
      relationships: {
        self: {
          model: { type: "b", nodeName: "b", labelName: "B" },
          direction: "out",
          relationship: "R2",
          cardinality: "one",
          description: "y",
          reverse: { name: "parent", description: "y" },
        },
      },
    });
    const b = descriptor({ type: "b", module: "m", description: "B", fields: {}, relationships: {} });
    const svc = new GraphCatalogService({ loadAll: () => [a, b, c] } as any);
    expect(() => svc.buildCatalog()).toThrow(/reverse relationship name/i);
  });
});
