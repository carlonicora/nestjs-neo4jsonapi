import { describe, expect, it, vi } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { GraphNodeService } from "../graph.node.service";

/**
 * The `assistant:status` line is emitted from inside the tool wrapper, so the
 * only way to prove a read is announced by name rather than by uuid is to drive
 * a turn through the wrapper itself.
 */
describe("GraphNodeService — assistant:status", () => {
  const buildTool = (name: string, result: unknown) =>
    ({
      build: () =>
        new DynamicStructuredTool({
          name,
          description: name,
          schema: z.object({}).passthrough(),
          func: async () => JSON.stringify(result),
        }),
    }) as any;

  /**
   * These stub tools bypass ToolFactory.capture, so the node's tool recorder
   * stays empty and its zero-tool-call retry always fires. Only the first LLM
   * pass drives tools, so the retry adds no second round of status events.
   */
  const buildSut = (llmCall: (args: any) => Promise<any>) => {
    const statuses: string[] = [];
    const ws = {
      sendMessageToUser: vi.fn(async (_userId: string, _event: string, payload: any) => {
        statuses.push(payload.status);
      }),
    } as any;

    let pass = 0;
    const service = new GraphNodeService(
      { call: vi.fn(async (args: any) => (pass++ === 0 ? llmCall(args) : { answer: "…", entities: [] })) } as any,
      { getTypeIndexFor: vi.fn(() => []) } as any,
      {} as any,
      buildTool("resolve_entity", {
        matchMode: "exact",
        items: [{ type: "npcs", id: "npc-1", summary: "Fabio", score: 9 }],
      }),
      buildTool("describe_entity", { fields: [], relationships: [] }),
      buildTool("search_entities", { matchMode: "none", items: [] }),
      buildTool("read_entity", { id: "npc-1", type: "npcs", fields: { name: "Fabio" } }),
      buildTool("traverse", { items: [] }),
      { get: vi.fn(() => undefined) } as any,
      ws,
    );

    return { service, statuses };
  };

  const state = {
    companyId: "c",
    userId: "u",
    userModuleIds: ["m-1"],
    question: "What can you tell me about Fabio?",
    chatHistory: [],
  } as any;

  it("names the record being read, using the label resolve_entity returned earlier in the turn", async () => {
    const { service, statuses } = buildSut(async ({ tools }: any) => {
      const call = (name: string, input: any) => tools.find((t: any) => t.name === name)!.func(input);
      await call("resolve_entity", { text: "Fabio" });
      await call("read_entity", { type: "npcs", id: "npc-1" });
      return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
    });

    await service.execute({ state });

    expect(statuses).toEqual(['Resolving "Fabio"', "Reading npcs · Fabio"]);
  });

  it("never prints a bare uuid when the record has not been named yet", async () => {
    const { service, statuses } = buildSut(async ({ tools }: any) => {
      const readTool = tools.find((t: any) => t.name === "read_entity")!;
      await readTool.func({ type: "npcs", id: "b415af20-21c3-4e22-a3b5-40ffbde5a03d" });
      return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
    });

    await service.execute({ state });

    expect(statuses).toEqual(["Reading npcs"]);
  });
});
