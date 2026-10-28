import { describe, expect, it, vi } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { GraphNodeService, fillEntityFields } from "../graph.node.service";
import { ToolFactory } from "../../../graph/tools/tool.factory";
import type { ToolCallRecord } from "../../../graph/tools/tool.factory";

/**
 * Entity fields in the lookup output come from the real tool results the
 * recorder captured, never from the model's copy of them.
 */

const noopTool = (name: string) =>
  ({
    build: () =>
      new DynamicStructuredTool({
        name,
        description: name,
        schema: z.object({}).passthrough(),
        func: async () => JSON.stringify({ ok: true }),
      }),
  }) as any;

describe("GraphNodeService — entity fields from the recorder", () => {
  it("fills entity fields from read_entity detail over traverse list", () => {
    const recorder: ToolCallRecord[] = [
      {
        tool: "traverse",
        input: {},
        durationMs: 1,
        entities: [
          { type: "locations", id: "l-1", fields: { name: "List name", tldr: "short" }, stage: "list" },
          { type: "locations", id: "l-2", fields: { name: "Other" }, stage: "list" },
        ],
      },
      {
        tool: "search_entities",
        input: {},
        durationMs: 1,
        entities: [{ type: "locations", id: "l-2", fields: { tldr: "merged" }, stage: "list" }],
      },
      {
        tool: "read_entity",
        input: {},
        durationMs: 1,
        entities: [{ type: "locations", id: "l-1", fields: { name: "Detail name", summary: "long" }, stage: "detail" }],
      },
      {
        tool: "traverse",
        input: {},
        durationMs: 1,
        entities: [{ type: "locations", id: "l-1", fields: { name: "Later list" }, stage: "list" }],
      },
    ];

    const out = fillEntityFields(
      [
        { type: "locations", id: "l-1", reason: "subject" },
        { type: "locations", id: "l-2", reason: "listed" },
      ],
      recorder,
    );

    expect(out[0]).toEqual({
      type: "locations",
      id: "l-1",
      reason: "subject",
      fields: { name: "Detail name", summary: "long" },
    });
    expect(out[1].fields).toEqual({ name: "Other", tldr: "merged" });
  });

  it("leaves fields empty for an entity no tool returned", () => {
    const recorder: ToolCallRecord[] = [
      {
        tool: "read_entity",
        input: {},
        durationMs: 1,
        entities: [{ type: "npcs", id: "n-1", fields: { name: "A" }, stage: "detail" }],
      },
      { tool: "traverse", input: {}, durationMs: 1, error: "boom" },
    ];

    const out = fillEntityFields([{ type: "npcs", id: "n-2", reason: "named only" }], recorder);

    expect(out).toEqual([{ type: "npcs", id: "n-2", reason: "named only" }]);
    expect("fields" in out[0]).toBe(false);
  });

  it("capture records list and detail entities", async () => {
    const factory = new ToolFactory({} as any, {} as any);
    vi.spyOn((factory as any).logger, "log").mockImplementation(() => undefined);
    const recorder: ToolCallRecord[] = [];

    await factory.capture(
      { tool: "read_entity", input: { id: "a" } },
      async () => ({ id: "a", type: "npcs", fields: { name: "A" } }),
      recorder,
    );
    await factory.capture(
      { tool: "traverse", input: {} },
      async () => ({
        items: [
          { id: "b", type: "locations", fields: { name: "B" } },
          { id: "c", type: "locations", summary: "no fields" },
        ],
      }),
      recorder,
    );
    await factory.capture(
      { tool: "read_entity", input: { id: "x" } },
      async () => ({ error: "No npcs with id x." }),
      recorder,
    );

    expect(recorder[0].entities).toEqual([{ type: "npcs", id: "a", fields: { name: "A" }, stage: "detail" }]);
    expect(recorder[1].entities).toEqual([{ type: "locations", id: "b", fields: { name: "B" }, stage: "list" }]);
    expect(recorder[2].entities).toBeUndefined();
  });

  it("output schema describes every field and has no entities[].fields", async () => {
    let captured: any;
    const call = vi.fn(async (args: any) => {
      captured = args.outputSchema;
      return { answer: "a", entities: [], stop: true, tokenUsage: { input: 1, output: 1 } };
    });
    const service = new GraphNodeService(
      { call } as any,
      { getTypeIndexFor: vi.fn(() => "- demo — anything") } as any,
      {} as any,
      noopTool("resolve_entity"),
      { ...noopTool("describe_entity"), renderCatalog: () => ({ text: "", types: [], approxTokens: 0 }) },
      noopTool("search_entities"),
      noopTool("read_entity"),
      noopTool("traverse"),
      { get: vi.fn(() => undefined) } as any,
    );
    vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);
    vi.spyOn((service as any).logger, "log").mockImplementation(() => undefined);

    await service.execute({
      state: { companyId: "c", userId: "u", userModuleIds: ["m"], question: "q", chatHistory: [] } as any,
    });

    const unwrap = (s: any): any => (s instanceof z.ZodOptional || s instanceof z.ZodNullable ? unwrap(s.unwrap()) : s);
    const walk = (schema: any, path: string, missing: string[]) => {
      const s = unwrap(schema);
      if (s instanceof z.ZodObject) {
        for (const [key, child] of Object.entries(s.shape)) {
          const p = path ? `${path}.${key}` : key;
          const d = (child as any).description;
          if (!d) missing.push(p);
          else {
            expect(d).not.toContain("`");
            expect(d).not.toContain("${");
          }
          walk(child, p, missing);
        }
      } else if (s instanceof z.ZodArray) {
        walk(s.element, `${path}[]`, missing);
      }
    };

    const missing: string[] = [];
    walk(captured, "", missing);
    expect(missing).toEqual([]);

    const item = unwrap(captured.shape.entities).element;
    expect(Object.keys(item.shape)).toEqual(["type", "id", "reason"]);
  });
});
