import { describe, expect, it, vi } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { GraphNodeService } from "../graph.node.service";
import type { ToolCallRecord } from "../../../graph/tools/tool.factory";

/**
 * The graph call declares an inputSchema describing every inputParams key.
 */

const recordingTool = (name: string) =>
  ({
    build: (_ctx: unknown, recorder: ToolCallRecord[]) =>
      new DynamicStructuredTool({
        name,
        description: name,
        schema: z.object({}).passthrough(),
        func: async (input: Record<string, unknown>) => {
          recorder.push({ tool: name, input, durationMs: 1 } as ToolCallRecord);
          return JSON.stringify({ ok: true });
        },
      }),
  }) as any;

const buildGraph = () => {
  const call = vi.fn(async (args: any) => {
    await args.tools.find((t: any) => t.name === "read_entity").func({});
    return { answer: "ok", entities: [], tokenUsage: { input: 1, output: 1 } };
  });
  const service = new GraphNodeService(
    { call } as any,
    { getTypeIndexFor: vi.fn(() => "- demo — anything") } as any,
    {} as any,
    recordingTool("resolve_entity"),
    recordingTool("describe_entity"),
    recordingTool("search_entities"),
    recordingTool("read_entity"),
    recordingTool("traverse"),
    { get: vi.fn(() => undefined) } as any,
  );
  return { service, call };
};

const baseState = {
  companyId: "c",
  userId: "u",
  userModuleIds: ["m-1"],
  rawQuestion: "q",
  question: "q",
  chatHistory: [],
} as any;

const describedKey = (schema: any, key: string): string | undefined => schema?.shape?.[key]?.description;

describe("graph call inputSchema", () => {
  it("describes every inputParams key", async () => {
    const graph = buildGraph();

    await graph.service.execute({ state: { ...baseState, contentType: "campaigns", contentId: "c-1" } });

    const args: any = graph.call.mock.calls[0][0];
    expect(describedKey(args.inputSchema, "question")).toBe("The user's question, refined for retrieval.");
    expect(describedKey(args.inputSchema, "contentScope")).toBe(
      "type:id of the single content the conversation is bound to, or null.",
    );
    expect(Object.keys(args.inputParams).sort()).toEqual(Object.keys(args.inputSchema.shape).sort());
    expect(args.inputParams.contentScope).toBe("campaigns:c-1");
  });
});
