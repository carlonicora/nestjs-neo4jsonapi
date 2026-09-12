import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpPromotedToolsFactory, descriptorFieldToJsonSchema } from "../services/mcp.promoted.tools.factory";

const ctx = { userId: "u1", companyId: "c1", userModuleIds: ["mod-orders"] };

/**
 * Mirrors the REAL CatalogEntity shape (src/agents/graph/interfaces/graph.catalog.interface.ts):
 * `fields`/`relationships` are ARRAYS of { name, ... } and `type`/`labelName`/`moduleId` are
 * top-level properties. (The plan's mock used keyed objects and a `model` nesting — deviation
 * from the plan flagged in the hand-off summary; the real catalog wins.)
 */
const orderEntity = {
  type: "orders",
  moduleId: "mod-orders",
  description: "Customer orders",
  labelName: "Order",
  nodeName: "order",
  fields: [
    { name: "name", type: "string", description: "Order name", filterable: true, sortable: true },
    { name: "orderDate", type: "date", description: "", filterable: true, sortable: true },
    { name: "total", type: "number", description: "", filterable: true, sortable: false },
  ],
  relationships: [
    {
      name: "account",
      sourceType: "orders",
      targetType: "accounts",
      cardinality: "one",
      description: "",
      cypherDirection: "out",
      cypherLabel: "HAS_ACCOUNT",
      isReverse: false,
    },
  ],
};

/** Same shape, but the descriptor sets `chat.writable: true` (mirrored onto the catalog entity). */
const writableOrderEntity = { ...orderEntity, writable: true };

/** Accessible but NOT writable: must stay out of the descriptor-driven default set. */
const invoiceEntity = { ...orderEntity, type: "invoices", labelName: "Invoice", nodeName: "invoice" };

describe("McpPromotedToolsFactory", () => {
  const config = { get: vi.fn() };
  const catalog = { getEntityDetail: vi.fn(), getAccessibleTypes: vi.fn() };
  const searchTool = { invoke: vi.fn().mockResolvedValue([{ id: "o1" }]) };
  const readTool = { invoke: vi.fn() };
  const writeService = { createEntity: vi.fn(), updateEntity: vi.fn() };
  let factory: McpPromotedToolsFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockReturnValue({ promotedEntities: ["orders", "invoices"] });
    catalog.getAccessibleTypes.mockReturnValue([]);
    catalog.getEntityDetail.mockImplementation((type: string) => (type === "orders" ? orderEntity : null));
    factory = new McpPromotedToolsFactory(
      config as any,
      catalog as any,
      searchTool as any,
      readTool as any,
      writeService as any,
    );
  });

  it("emits 4 tools per accessible promoted entity, skips inaccessible ones", () => {
    const tools = factory.build(ctx);
    expect(tools.map((t) => t.name).sort()).toEqual(["create_orders", "get_orders", "search_orders", "update_orders"]);
  });

  it("derives JSON Schema types from descriptor fields", () => {
    const create = factory.build(ctx).find((t) => t.name === "create_orders")!;
    const props = (create.inputSchema as any).properties.attributes.properties;
    expect(props.name).toMatchObject({ type: "string", description: "Order name" });
    expect(props.orderDate).toMatchObject({ type: "string", format: "date" });
    expect(props.total).toMatchObject({ type: "number" });
    expect(create.readOnly).toBe(false);
  });

  it("search_orders pre-binds the type and delegates to SearchEntitiesTool", async () => {
    const search = factory.build(ctx).find((t) => t.name === "search_orders")!;
    await search.execute({ term: "acme" }, ctx);
    expect(searchTool.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ type: "orders", term: "acme" }),
      ctx,
      expect.any(Array),
    );
    expect(search.readOnly).toBe(true);
  });

  it("get_orders pre-binds the type and delegates to ReadEntityTool", async () => {
    readTool.invoke.mockResolvedValue({ id: "o1", type: "orders" });
    const get = factory.build(ctx).find((t) => t.name === "get_orders")!;
    await get.execute({ id: "o1" }, ctx);
    expect(readTool.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ type: "orders", id: "o1" }),
      ctx,
      expect.any(Array),
    );
    expect(get.readOnly).toBe(true);
  });

  it("pre-seeds the recorder with describe_entity records so the graph tools' describe-first guard passes", async () => {
    const search = factory.build(ctx).find((t) => t.name === "search_orders")!;
    await search.execute({}, ctx);
    const recorder = searchTool.invoke.mock.calls[0][2];
    expect(recorder).toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: "describe_entity", input: { type: "orders" } })]),
    );
  });

  it("create_orders and update_orders delegate to McpEntityWriteService with the type pre-bound", async () => {
    writeService.createEntity.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    writeService.updateEntity.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    const tools = factory.build(ctx);

    await tools.find((t) => t.name === "create_orders")!.execute({ attributes: { name: "New" } }, ctx);
    expect(writeService.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "orders", attributes: { name: "New" } }),
      ctx,
    );

    await tools.find((t) => t.name === "update_orders")!.execute({ id: "o1", attributes: { name: "New" } }, ctx);
    expect(writeService.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "orders", id: "o1", attributes: { name: "New" } }),
      ctx,
    );
  });

  it("update_orders description carries the PUT-replaces-all warning", () => {
    const update = factory.build(ctx).find((t) => t.name === "update_orders")!;
    expect(update.description).toMatch(/replaces all attributes/i);
    expect(update.description).toMatch(/read the record first and send every field back/i);
  });

  it("embeds the entity catalog description in tool descriptions when present", () => {
    const search = factory.build(ctx).find((t) => t.name === "search_orders")!;
    expect(search.description).toContain("Customer orders");
  });

  it("returns no tools when config has no promoted entities and nothing is accessible", () => {
    config.get.mockReturnValueOnce({ promotedEntities: [] });
    expect(factory.build(ctx)).toEqual([]);
  });

  it("with an empty config, promotes only the accessible types whose descriptor is writable", () => {
    config.get.mockReturnValueOnce({ promotedEntities: [] });
    catalog.getAccessibleTypes.mockReturnValueOnce(["invoices", "orders"]);
    catalog.getEntityDetail.mockImplementation((type: string) => {
      if (type === "orders") return writableOrderEntity;
      if (type === "invoices") return invoiceEntity;
      return null;
    });

    const tools = factory.build(ctx);

    expect(tools.map((t) => t.name).sort()).toEqual(["create_orders", "get_orders", "search_orders", "update_orders"]);
    expect(catalog.getAccessibleTypes).toHaveBeenCalledWith(ctx.userModuleIds);
  });

  it("with an empty config and no writable type, returns no tools", () => {
    config.get.mockReturnValueOnce({ promotedEntities: [] });
    catalog.getAccessibleTypes.mockReturnValueOnce(["invoices", "orders"]);
    catalog.getEntityDetail.mockImplementation((type: string) => {
      if (type === "orders") return orderEntity;
      if (type === "invoices") return invoiceEntity;
      return null;
    });

    expect(factory.build(ctx)).toEqual([]);
  });

  it("a non-empty config is an explicit override: a non-writable type listed there is still promoted", () => {
    config.get.mockReturnValueOnce({ promotedEntities: ["orders"] });

    const tools = factory.build(ctx);

    expect((orderEntity as { writable?: boolean }).writable).toBeUndefined();
    expect(tools.map((t) => t.name).sort()).toEqual(["create_orders", "get_orders", "search_orders", "update_orders"]);
    expect(catalog.getAccessibleTypes).not.toHaveBeenCalled();
  });
});

describe("descriptorFieldToJsonSchema", () => {
  it("maps descriptor scalar types to JSON Schema", () => {
    expect(descriptorFieldToJsonSchema({ type: "string" })).toEqual({ type: "string" });
    expect(descriptorFieldToJsonSchema({ type: "number" })).toEqual({ type: "number" });
    expect(descriptorFieldToJsonSchema({ type: "boolean" })).toEqual({ type: "boolean" });
  });

  it("maps date/datetime to string with wire formats (storage stays native; no custom Cypher)", () => {
    expect(descriptorFieldToJsonSchema({ type: "date" })).toEqual({ type: "string", format: "date" });
    expect(descriptorFieldToJsonSchema({ type: "datetime" })).toEqual({ type: "string", format: "date-time" });
  });

  it("falls back to string for unknown types and carries description through", () => {
    expect(descriptorFieldToJsonSchema({ type: "string[]" })).toEqual({ type: "string" });
    expect(descriptorFieldToJsonSchema({ type: "number", description: "Total" })).toEqual({
      type: "number",
      description: "Total",
    });
  });
});
