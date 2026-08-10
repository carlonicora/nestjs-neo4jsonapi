import { describe, expect, it, vi } from "vitest";
import { EntityWriteTools } from "../entity-write.tools";

const npc = {
  type: "npcs",
  labelName: "Npc",
  nodeName: "npc",
  moduleId: "m-npc",
  description: "An npc.",
  writable: true,
  fields: [
    { name: "name", type: "string", description: "Name.", filterable: true, sortable: true },
    { name: "description", type: "string", description: "Notes.", filterable: false, sortable: false },
  ],
  relationships: [],
  scope: {
    rootType: "campaigns",
    rootLabel: "Campaign",
    path: [
      {
        key: "campaign",
        cypherLabel: "PART_OF",
        cypherDirection: "out",
        targetLabel: "Campaign",
        targetType: "campaigns",
      },
    ],
  },
} as any;

const readOnly = { ...npc, type: "sessions", writable: false };
const ctx = { companyId: "c", userId: "u", userModuleIds: ["m-npc"], scopeId: "camp-1", scopeType: "campaigns" };

describe("EntityWriteTools", () => {
  it("builds no tools when no catalogued type is writable", () => {
    const catalog = { getAllChatEnabledEntities: () => [readOnly] };
    const tools = new EntityWriteTools(catalog as any, {} as any, {} as any).buildDefinitions(ctx as any, []);
    expect(tools).toEqual([]);
  });

  it("marks every write tool destructive and gives it a summary", () => {
    const catalog = { getAllChatEnabledEntities: () => [npc] };
    const definitions = new EntityWriteTools(catalog as any, {} as any, {} as any).buildDefinitions(ctx as any, []);

    expect(definitions.map((d) => d.tool.name).sort()).toEqual([
      "create_entity",
      "delete_entity",
      "link_entities",
      "unlink_entities",
      "update_entity",
    ]);
    for (const definition of definitions) {
      expect(definition.destructive).toBe(true);
      expect(typeof definition.summarise).toBe("function");
    }
  });

  it("injects the scope relationship on create so another campaign is unreachable", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const catalog = { getAllChatEnabledEntities: () => [npc], getEntityDetail: () => npc };
    const registry = { get: () => ({ create }) };
    const tools = new EntityWriteTools(catalog as any, registry as any, { isInScope: async () => true } as any);

    await tools.createEntity(
      { type: "npcs", fields: { name: "New" }, relationships: { campaign: "camp-999" } },
      ctx as any,
      [],
    );

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ campaign: "camp-1" }));
  });

  it("rejects a field that is not on the catalogued entity", async () => {
    const create = vi.fn();
    const catalog = { getAllChatEnabledEntities: () => [npc], getEntityDetail: () => npc };
    const tools = new EntityWriteTools(
      catalog as any,
      { get: () => ({ create }) } as any,
      {
        isInScope: async () => true,
      } as any,
    );

    const result: any = await tools.createEntity({ type: "npcs", fields: { nickname: "x" } }, ctx as any, []);

    expect(result.error).toMatch(/nickname/);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses to update a record outside the scope", async () => {
    const update = vi.fn();
    const catalog = { getAllChatEnabledEntities: () => [npc], getEntityDetail: () => npc };
    const tools = new EntityWriteTools(
      catalog as any,
      { get: () => ({ update }) } as any,
      {
        isInScope: async () => false,
      } as any,
    );

    const result: any = await tools.updateEntity({ type: "npcs", id: "other", fields: { name: "x" } }, ctx as any, []);

    expect(result.error).toMatch(/not found/i);
    expect(update).not.toHaveBeenCalled();
  });
});
