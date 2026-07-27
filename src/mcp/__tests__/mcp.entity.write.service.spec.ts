import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpEntityWriteService } from "../services/mcp.entity.write.service";

const ctx = { userId: "u1", companyId: "c1", userModuleIds: ["mod-orders"] };

/**
 * Catalog mock mirrors the REAL CatalogEntity shape
 * (src/agents/graph/interfaces/graph.catalog.interface.ts):
 * fields/relationships are ARRAYS of { name, ... } and labelName is top-level.
 */
const orderEntity = {
  type: "orders",
  moduleId: "mod-orders",
  description: "Sales orders",
  labelName: "Order",
  nodeName: "order",
  fields: [
    { name: "name", type: "string", description: "Order name", filterable: true, sortable: true },
    { name: "total", type: "float", description: "Order total", filterable: true, sortable: true },
  ],
  relationships: [
    {
      name: "account",
      sourceType: "orders",
      targetType: "accounts",
      cardinality: "many",
      description: "",
      cypherDirection: "out",
      cypherLabel: "BELONGS_TO",
      isReverse: false,
    },
  ],
};

describe("McpEntityWriteService", () => {
  let svc: McpEntityWriteService;
  const entityService = {
    createFromDTO: vi.fn(),
    patchFromDTO: vi.fn(),
    findRecordById: vi.fn(),
    addToRelationshipFromDTO: vi.fn(),
    removeFromRelationshipFromDTO: vi.fn(),
  };
  const registry = { get: vi.fn() };
  const catalog = { getEntityDetail: vi.fn() };
  const rbac = { can: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    entityService.createFromDTO.mockResolvedValue({ data: { id: "new-id", type: "orders" } });
    entityService.patchFromDTO.mockResolvedValue({ data: { id: "o1", type: "orders" } });
    entityService.findRecordById.mockResolvedValue({ id: "o1", name: "Old" });
    entityService.addToRelationshipFromDTO.mockResolvedValue({ data: { id: "o1", type: "orders" } });
    entityService.removeFromRelationshipFromDTO.mockResolvedValue({ data: { id: "o1", type: "orders" } });
    registry.get.mockReturnValue(entityService);
    catalog.getEntityDetail.mockReturnValue(orderEntity);
    rbac.can.mockResolvedValue(true);
    svc = new McpEntityWriteService(registry as any, catalog as any, rbac as any);
  });

  it("creates: builds JsonApiDTOData with generated id", async () => {
    const res = await svc.createEntity({ type: "orders", attributes: { name: "New order" } }, ctx);
    const call = entityService.createFromDTO.mock.calls[0][0];
    expect(call.data.type).toBe("orders");
    expect(call.data.id).toMatch(/[0-9a-f-]{36}/);
    expect(call.data.attributes).toEqual({ name: "New order" });
    expect(rbac.can).toHaveBeenCalledWith({ userId: "u1", moduleId: "mod-orders", action: "create" });
    expect(res.isError).toBeUndefined();
  });

  it("creates: passes relationships through to the DTO when provided", async () => {
    await svc.createEntity(
      {
        type: "orders",
        attributes: { name: "N" },
        relationships: { account: { data: [{ type: "accounts", id: "a1" }] } },
      },
      ctx,
    );
    const call = entityService.createFromDTO.mock.calls[0][0];
    expect(call.data.relationships).toEqual({ account: { data: [{ type: "accounts", id: "a1" }] } });
  });

  it("rejects unknown attribute keys with validation_failed", async () => {
    const res = await svc.createEntity({ type: "orders", attributes: { bogus: 1 } }, ctx);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).code).toBe("validation_failed");
    expect(entityService.createFromDTO).not.toHaveBeenCalled();
  });

  it("denies when rbac.can is false", async () => {
    rbac.can.mockResolvedValue(false);
    const res = await svc.updateEntity({ type: "orders", id: "o1", attributes: { name: "X" } }, ctx);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).code).toBe("forbidden");
    expect(entityService.patchFromDTO).not.toHaveBeenCalled();
  });

  it("updates: patch-from-DTO with before-fetch existence check", async () => {
    await svc.updateEntity({ type: "orders", id: "o1", attributes: { name: "New" } }, ctx);
    expect(entityService.findRecordById).toHaveBeenCalledWith({ id: "o1" });
    expect(entityService.patchFromDTO).toHaveBeenCalledWith({
      data: { id: "o1", type: "orders", attributes: { name: "New" } },
    });
    expect(rbac.can).toHaveBeenCalledWith({ userId: "u1", moduleId: "mod-orders", action: "update" });
  });

  it("updates: missing record → not_found without dispatching", async () => {
    entityService.findRecordById.mockResolvedValue(null);
    const res = await svc.updateEntity({ type: "orders", id: "nope", attributes: { name: "X" } }, ctx);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).code).toBe("not_found");
    expect(entityService.patchFromDTO).not.toHaveBeenCalled();
  });

  it("unknown type (not in user catalog) → unknown_type", async () => {
    catalog.getEntityDetail.mockReturnValueOnce(null);
    const res = await svc.createEntity({ type: "wat", attributes: {} }, ctx);
    expect(JSON.parse(res.content[0].text).code).toBe("unknown_type");
  });

  it("unregistered service → unknown_type", async () => {
    registry.get.mockReturnValue(undefined);
    const res = await svc.createEntity({ type: "orders", attributes: { name: "N" } }, ctx);
    expect(JSON.parse(res.content[0].text).code).toBe("unknown_type");
  });

  it("addRelationship: rbac update check, maps relatedIds to DTO items", async () => {
    const res = await svc.addRelationship(
      { type: "orders", id: "o1", relationship: "account", relatedType: "accounts", relatedIds: ["a1", "a2"] },
      ctx,
    );
    expect(rbac.can).toHaveBeenCalledWith({ userId: "u1", moduleId: "mod-orders", action: "update" });
    expect(entityService.addToRelationshipFromDTO).toHaveBeenCalledWith({
      id: "o1",
      relationship: "account",
      data: [
        { type: "accounts", id: "a1" },
        { type: "accounts", id: "a2" },
      ],
    });
    expect(res.isError).toBeUndefined();
  });

  it("removeRelationship: dispatches removeFromRelationshipFromDTO", async () => {
    await svc.removeRelationship(
      { type: "orders", id: "o1", relationship: "account", relatedType: "accounts", relatedIds: ["a1"] },
      ctx,
    );
    expect(entityService.removeFromRelationshipFromDTO).toHaveBeenCalledWith({
      id: "o1",
      relationship: "account",
      data: [{ type: "accounts", id: "a1" }],
    });
  });

  it("maps thrown HttpExceptions to flat error payloads (404 → not_found)", async () => {
    const { NotFoundException } = await import("@nestjs/common");
    entityService.addToRelationshipFromDTO.mockRejectedValue(new NotFoundException("Order not found"));
    const res = await svc.addRelationship(
      { type: "orders", id: "o1", relationship: "account", relatedType: "accounts", relatedIds: ["a1"] },
      ctx,
    );
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.code).toBe("not_found");
    expect(payload.stack).toBeUndefined();
  });

  describe("buildTools", () => {
    it("emits the four write tools, all readOnly: false", () => {
      const tools = svc.buildTools(ctx as any);
      expect(tools.map((t) => t.name)).toEqual([
        "create_entity",
        "update_entity",
        "add_relationship",
        "remove_relationship",
      ]);
      expect(tools.every((t) => t.readOnly === false)).toBe(true);
    });

    it("update_entity description states partial-update semantics", () => {
      const update = svc.buildTools(ctx as any).find((t) => t.name === "update_entity")!;
      expect(update.description).toContain("Partial update");
      expect(update.description).toContain("omitted attributes and all relationships are left untouched");
    });

    it("tool input schemas match the C4 params", () => {
      const tools = svc.buildTools(ctx as any);
      const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema as any]));
      expect(Object.keys(byName.create_entity.properties)).toEqual(["type", "attributes", "relationships"]);
      expect(byName.create_entity.required).toEqual(["type", "attributes"]);
      expect(Object.keys(byName.update_entity.properties)).toEqual(["type", "id", "attributes"]);
      expect(byName.update_entity.required).toEqual(["type", "id", "attributes"]);
      for (const name of ["add_relationship", "remove_relationship"]) {
        expect(Object.keys(byName[name].properties)).toEqual([
          "type",
          "id",
          "relationship",
          "relatedType",
          "relatedIds",
        ]);
        expect(byName[name].required).toEqual(["type", "id", "relationship", "relatedType", "relatedIds"]);
        expect(byName[name].properties.relatedIds).toEqual({
          type: "array",
          items: { type: "string" },
          minItems: 1,
        });
      }
    });

    it("tools delegate to the write methods", async () => {
      const create = svc.buildTools(ctx as any).find((t) => t.name === "create_entity")!;
      const res = await create.execute({ type: "orders", attributes: { name: "Via tool" } }, ctx as any);
      expect(entityService.createFromDTO).toHaveBeenCalled();
      expect(res.isError).toBeUndefined();
    });
  });
});
