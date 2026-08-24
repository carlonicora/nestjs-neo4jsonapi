import { describe, expect, it, vi } from "vitest";
import { SearchEntitiesTool } from "../search-entities.tool";
import { ReadEntityTool } from "../read-entity.tool";
import { ToolFieldFormatterService } from "../../services/field-formatting";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";

const formatter = new ToolFieldFormatterService(new BlockNoteService());

const npc = {
  type: "npcs",
  labelName: "Npc",
  nodeName: "npc",
  moduleId: "m-npc",
  description: "An npc.",
  fields: [{ name: "name", type: "string", description: "Name.", filterable: true, sortable: true }],
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

const ctx = { companyId: "c", userId: "u", userModuleIds: ["m-npc"], scopeId: "camp-1", scopeType: "campaigns" };

describe("search_entities under scope", () => {
  it("queries across the scope relationship instead of the whole company", async () => {
    const findRelatedRecords = vi.fn().mockResolvedValue([{ id: "n1", name: "A" }]);
    const findRecords = vi.fn();
    const factory = {
      resolveEntity: () => npc,
      resolveService: () => ({ findRelatedRecords, findRecords }),
      capture: (_r: any, fn: any) => fn(),
    };
    const tool = new SearchEntitiesTool(
      factory as any,
      {} as any,
      {} as any,
      {} as any,
      { filter: async (p: any) => p.records } as any,
      formatter,
    );

    const recorder = [{ tool: "describe_entity", input: { type: "npcs" }, durationMs: 0 }];
    await tool.invoke({ type: "npcs", limit: 5 } as any, ctx as any, recorder as any);

    expect(findRecords).not.toHaveBeenCalled();
    expect(findRelatedRecords).toHaveBeenCalledWith(
      expect.objectContaining({ relationship: "campaign", id: "camp-1" }),
    );
  });

  it("falls back to findRecords when the run is unscoped", async () => {
    const findRelatedRecords = vi.fn();
    const findRecords = vi.fn().mockResolvedValue([]);
    const factory = {
      resolveEntity: () => npc,
      resolveService: () => ({ findRelatedRecords, findRecords }),
      capture: (_r: any, fn: any) => fn(),
    };
    const tool = new SearchEntitiesTool(
      factory as any,
      {} as any,
      {} as any,
      {} as any,
      { filter: async (p: any) => p.records } as any,
      formatter,
    );

    const recorder = [{ tool: "describe_entity", input: { type: "npcs" }, durationMs: 0 }];
    await tool.invoke(
      { type: "npcs", limit: 5 } as any,
      { ...ctx, scopeId: undefined, scopeType: undefined } as any,
      recorder as any,
    );

    expect(findRelatedRecords).not.toHaveBeenCalled();
    expect(findRecords).toHaveBeenCalled();
  });
});

describe("read_entity under scope", () => {
  it("reports an out-of-scope id as not found and never reads the record", async () => {
    const findRecordById = vi.fn();
    const factory = {
      resolveEntity: () => npc,
      resolveService: () => ({ findRecordById }),
      capture: (_r: any, fn: any) => fn(),
    };
    const guard = { isInScope: vi.fn().mockResolvedValue(false), filter: async (p: any) => p.records };
    const tool = new ReadEntityTool(factory as any, {} as any, {} as any, guard as any, formatter);

    const recorder = [{ tool: "describe_entity", input: { type: "npcs" }, durationMs: 0 }];
    const result: any = await tool.invoke(
      { type: "npcs", id: "other-campaign-npc" } as any,
      ctx as any,
      recorder as any,
    );

    // Must be the exact string a genuinely missing record produces
    // (read-entity.tool.ts: `No ${entity.type} with id ${input.id}.`), so an
    // out-of-scope id is indistinguishable from a deleted one.
    expect(result.error).toBe("No npcs with id other-campaign-npc.");
    expect(findRecordById).not.toHaveBeenCalled();
  });
});
