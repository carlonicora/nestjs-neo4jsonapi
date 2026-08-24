import { GraphCatalogService } from "../graph.catalog.service";

function descriptor(opts: Partial<any>): any {
  return {
    model: { type: opts.type, nodeName: opts.type, labelName: opts.type },
    description: opts.description,
    moduleId: opts.moduleId,
    fields: opts.fields ?? {},
    relationships: opts.relationships ?? {},
    chat: opts.chat,
  };
}

describe("GraphCatalogService", () => {
  const account = descriptor({
    type: "accounts",
    moduleId: "11111111-1111-1111-1111-111111111111",
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
    moduleId: "22222222-2222-2222-2222-222222222222",
    description: "A sales order.",
    fields: { total: { type: "number", description: "Total value in EUR." } },
    relationships: {},
  });

  const undescribedWidget = descriptor({
    type: "widgets",
    moduleId: "11111111-1111-1111-1111-111111111111",
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
    const orderDetail = svc.getEntityDetail("orders", [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    expect(orderDetail?.relationships.map((r) => r.name)).toContain("account");
    const reverse = orderDetail!.relationships.find((r) => r.name === "account");
    expect(reverse?.isReverse).toBe(true);
    expect(reverse?.cypherDirection).toBe("in");
    expect(reverse?.inverseKey).toBe("orders");
  });

  it("drops fields that have no description", () => {
    const svc = new GraphCatalogService({ loadAll } as any);
    svc.buildCatalog();
    const accountDetail = svc.getEntityDetail("accounts", [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    expect(accountDetail?.fields.map((f) => f.name)).toEqual(["name"]);
  });

  it("getMapFor only includes entities in the user's modules", () => {
    const svc = new GraphCatalogService({ loadAll } as any);
    svc.buildCatalog();
    const map = svc.getMapFor(["11111111-1111-1111-1111-111111111111"]);
    expect(map).toContain("accounts");
    expect(map).not.toContain("orders"); // sales module not enabled
  });

  it("getMapFor drops relationship lines whose target is in an inaccessible module", () => {
    const svc = new GraphCatalogService({ loadAll } as any);
    svc.buildCatalog();
    const map = svc.getMapFor(["11111111-1111-1111-1111-111111111111"]);
    // The account.orders relationship target is 'orders' (sales module); line must be dropped.
    expect(map).not.toContain("account.orders");
  });

  describe("getTypeIndexFor", () => {
    it("returns one line per accessible entity in the form `- type — description`", () => {
      const svc = new GraphCatalogService({ loadAll } as any);
      svc.buildCatalog();
      const index = svc.getTypeIndexFor([
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ]);
      const lines = index.split("\n").filter(Boolean);
      expect(lines).toContain("- accounts — A customer or supplier.");
      expect(lines).toContain("- orders — A sales order.");
    });

    it("filters by userModuleIds (entities in inaccessible modules are dropped)", () => {
      const svc = new GraphCatalogService({ loadAll } as any);
      svc.buildCatalog();
      const index = svc.getTypeIndexFor(["11111111-1111-1111-1111-111111111111"]);
      expect(index).toContain("accounts");
      expect(index).not.toContain("orders");
    });

    it("excludes fields and relationship descriptions (the index is types-only)", () => {
      const svc = new GraphCatalogService({ loadAll } as any);
      svc.buildCatalog();
      const index = svc.getTypeIndexFor([
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ]);
      // Field names from the descriptors must not appear.
      expect(index).not.toContain("name");
      expect(index).not.toContain("total");
      // Relationship lines from getMapFor must not appear.
      expect(index).not.toContain("-->");
      expect(index).not.toContain("PLACED");
    });

    it("returns an empty string when userModuleIds is empty", () => {
      const svc = new GraphCatalogService({ loadAll } as any);
      svc.buildCatalog();
      expect(svc.getTypeIndexFor([])).toBe("");
    });

    it("ignores entities without a description (same filter as buildCatalog)", () => {
      const svc = new GraphCatalogService({ loadAll } as any);
      svc.buildCatalog();
      const index = svc.getTypeIndexFor(["11111111-1111-1111-1111-111111111111"]);
      expect(index).not.toContain("widgets");
    });
  });

  describe("bridge support", () => {
    const moduleId = "00000000-0000-0000-0000-000000000001";

    function makeSource(extra: Partial<{ withInvalidBridgeTarget: boolean }> = {}) {
      return {
        loadAll() {
          const items = {
            model: { type: "items", nodeName: "item", labelName: "Item" },
            description: "An item.",
            moduleId,
            fields: { name: { type: "string", description: "Name." } },
            relationships: {},
          };
          const bomEntries = {
            model: { type: "bom-entries", nodeName: "bomEntry", labelName: "BomEntry" },
            description: "Junction record.",
            moduleId,
            fields: { position: { type: "number", description: "Row order." } },
            relationships: {
              item: {
                model: {
                  type: extra.withInvalidBridgeTarget ? "missing" : "items",
                  nodeName: "item",
                  labelName: "Item",
                },
                direction: "out" as const,
                relationship: "FOR_ITEM",
                cardinality: "one" as const,
                description: "Item this entry refers to.",
              },
            },
            bridge: { materialiseTo: ["item"] },
          };
          return [items, bomEntries];
        },
      } as any;
    }

    it("carries bridge onto the CatalogEntity", () => {
      const svc = new GraphCatalogService(makeSource());
      svc.buildCatalog();
      const entry = (svc as any).entities.get("bom-entries");
      expect(entry.bridge).toEqual({ materialiseTo: ["item"] });
    });

    it("renders the (bridge → …) marker in getTypeIndexFor", () => {
      const svc = new GraphCatalogService(makeSource());
      svc.buildCatalog();
      const text = svc.getTypeIndexFor([moduleId]);
      expect(text).toMatch(/- bom-entries — Junction record\. \(bridge → item\)/);
      expect(text).toMatch(/- items — An item\.$/m);
    });

    it("drops the materialiseTo entry when a bridge target type is missing from the catalog", () => {
      const svc = new GraphCatalogService(makeSource({ withInvalidBridgeTarget: true }));
      expect(() => svc.buildCatalog()).not.toThrow();
      const entry = (svc as any).entities.get("bom-entries");
      expect(entry.bridge).toEqual({ materialiseTo: [] });
    });
  });

  describe("chat.list", () => {
    const npc = descriptor({
      type: "npcs",
      moduleId: "44444444-4444-4444-4444-444444444444",
      description: "A non-player character.",
      fields: {
        name: { type: "string", description: "Display name." },
        tldr: { type: "string", description: "One-line summary." },
        summary: { type: "string", description: "Long-form summary." },
      },
      relationships: {},
      chat: { list: ["name", "tldr", "summary"] },
    });

    const npcNoList = descriptor({
      type: "npcs-no-list",
      moduleId: "44444444-4444-4444-4444-444444444444",
      description: "A non-player character without a declared list.",
      fields: {
        name: { type: "string", description: "Display name." },
      },
      relationships: {},
    });

    it("compiles chat.list onto CatalogEntity in declaration order", () => {
      const svc = new GraphCatalogService({ loadAll: () => [npc] } as any);
      svc.buildCatalog();
      const detail = svc.getEntityDetail("npcs", ["44444444-4444-4444-4444-444444444444"]);
      expect(detail?.list).toEqual(["name", "tldr", "summary"]);
    });

    it("throws at buildCatalog when chat.list names an undescribed field", () => {
      const badNpc = descriptor({
        type: "npcs",
        moduleId: "44444444-4444-4444-4444-444444444444",
        description: "A non-player character.",
        fields: {
          name: { type: "string", description: "Display name." },
        },
        relationships: {},
        chat: { list: ["name", "nope"] },
      });
      const svc = new GraphCatalogService({ loadAll: () => [badNpc] } as any);
      expect(() => svc.buildCatalog()).toThrow(/chat\.list.*"nope".*not a described field/);
    });

    it("leaves CatalogEntity.list undefined when chat.list is not declared", () => {
      const svc = new GraphCatalogService({ loadAll: () => [npcNoList] } as any);
      svc.buildCatalog();
      const detail = svc.getEntityDetail("npcs-no-list", ["44444444-4444-4444-4444-444444444444"]);
      expect(detail?.list).toBeUndefined();
    });
  });

  describe("chat.related", () => {
    const relatedModuleId = "55555555-5555-5555-5555-555555555555";

    const things = descriptor({
      type: "things",
      moduleId: relatedModuleId,
      description: "A thing.",
      fields: { name: { type: "string", description: "Display name." } },
      relationships: {},
      chat: { related: true },
    });

    const plainThings = descriptor({
      type: "plainthings",
      moduleId: relatedModuleId,
      description: "A thing that declares no related traversal.",
      fields: { name: { type: "string", description: "Display name." } },
      relationships: {},
    });

    it("compiles a polymorphic related relationship onto the entity", () => {
      const svc = new GraphCatalogService({ loadAll: () => [things] } as any);
      svc.buildCatalog();
      const entity = svc.getAllEntities().find((x) => x.type === "things")!;
      const rel = entity.relationships.find((r) => r.name === "related")!;
      expect(rel).toMatchObject({
        name: "related",
        sourceType: "things",
        targetType: "*",
        cardinality: "many",
        cypherDirection: "out",
        cypherLabel: "RELATES_TO",
        isReverse: false,
        polymorphic: true,
      });
      expect(rel.description).toBe(
        "Records linked to this one by mentions or GM-drawn links. Results carry their own type.",
      );
    });

    it("omits related when chat.related is not declared", () => {
      const svc = new GraphCatalogService({ loadAll: () => [plainThings] } as any);
      svc.buildCatalog();
      const entity = svc.getAllEntities().find((x) => x.type === "plainthings")!;
      expect(entity.relationships.find((r) => r.name === "related")).toBeUndefined();
    });

    it("keeps the polymorphic line in the cross-module filtered map", () => {
      const svc = new GraphCatalogService({ loadAll: () => [things, plainThings] } as any);
      svc.buildCatalog();
      const map = svc.getMapFor([relatedModuleId]);
      expect(map).toContain("(things) --> (*)");
      expect(map).toContain("[things.related]");
    });
  });

  it("throws on reverse-name collision at build time", () => {
    const a = descriptor({
      type: "a",
      moduleId: "33333333-3333-3333-3333-333333333333",
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
      moduleId: "33333333-3333-3333-3333-333333333333",
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
    const b = descriptor({
      type: "b",
      moduleId: "33333333-3333-3333-3333-333333333333",
      description: "B",
      fields: {},
      relationships: {},
    });
    const svc = new GraphCatalogService({ loadAll: () => [a, b, c] } as any);
    expect(() => svc.buildCatalog()).toThrow(/reverse relationship name/i);
  });
});
