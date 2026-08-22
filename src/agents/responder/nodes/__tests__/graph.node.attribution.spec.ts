import { describe, expect, it, vi } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { GraphNodeService } from "../graph.node.service";
import { modelRegistry } from "../../../../common/registries/registry";
import type { ToolCallRecord } from "../../../graph/tools/tool.factory";

/**
 * The graph node re-invokes the LLM up to three extra times (zero-tool retry,
 * apology recovery, data-loading recovery). Every one of those retries is billed
 * by the provider, so EVERY call — not just the first — must carry attribution.
 */
describe("GraphNodeService — usage attribution", () => {
  modelRegistry.register({ nodeName: "campaign", labelName: "Campaign", type: "campaigns" } as any);

  const state = {
    companyId: "c",
    userId: "u",
    userModuleIds: ["m-1"],
    question: "What can you tell me about Fabio?",
    chatHistory: [],
    scopeId: "campaign-1",
    scopeType: "campaigns",
  } as any;

  /** Stub tool whose invocation writes `record` into the node's recorder, like ToolFactory.capture. */
  const recordingTool = (name: string, record: Partial<ToolCallRecord>) =>
    ({
      build: (_ctx: unknown, recorder: ToolCallRecord[]) =>
        new DynamicStructuredTool({
          name,
          description: name,
          schema: z.object({}).passthrough(),
          func: async (input: Record<string, unknown>) => {
            recorder.push({ tool: name, input, durationMs: 1, ...record });
            return JSON.stringify({ ok: true });
          },
        }),
    }) as any;

  const buildSut = (call: ReturnType<typeof vi.fn>) =>
    new GraphNodeService(
      { call } as any,
      { getTypeIndexFor: vi.fn(() => []) } as any,
      {} as any,
      recordingTool("resolve_entity", { error: "boom" }),
      recordingTool("describe_entity", {}),
      recordingTool("search_entities", {}),
      recordingTool("read_entity", {}),
      recordingTool("traverse", {}),
      { get: vi.fn(() => undefined) } as any,
    );

  const expectedAttribution = {
    tokenUsageType: "responder",
    relationshipId: "campaign-1",
    relationshipType: "Campaign",
  };

  it("attributes the first call and the zero-tool-call retry", async () => {
    const call = vi.fn(async () => ({ answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } }));
    await buildSut(call).execute({ state });

    expect(call).toHaveBeenCalledTimes(2);
    for (const [args] of call.mock.calls) expect(args).toMatchObject(expectedAttribution);
  });

  it("attributes the apology-recovery and data-loading retries", async () => {
    let pass = 0;
    const call = vi.fn(async ({ tools }: any) => {
      if (pass++ === 0) {
        await tools.find((t: any) => t.name === "resolve_entity")!.func({ text: "Fabio" });
        return { answer: "I am sorry, I cannot help with that.", entities: [], tokenUsage: { input: 1, output: 1 } };
      }
      return { answer: "here you go", entities: [], tokenUsage: { input: 1, output: 1 } };
    });

    await buildSut(call).execute({ state });

    // first pass + apology recovery + data-loading recovery
    expect(call).toHaveBeenCalledTimes(3);
    for (const [args] of call.mock.calls) expect(args).toMatchObject(expectedAttribution);
  });

  it("falls back to the assistant thread when the turn has no scope root", async () => {
    const call = vi.fn(async () => ({ answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } }));
    await buildSut(call).execute({
      state: { ...state, scopeId: undefined, scopeType: undefined, assistantId: "assistant-1" },
    });

    // first pass + zero-tool-call retry: without this the loop below would pass
    // vacuously against zero calls, i.e. it would still pass with attribution removed.
    expect(call).toHaveBeenCalledTimes(2);
    for (const [args] of call.mock.calls) {
      expect(args).toMatchObject({
        tokenUsageType: "responder",
        relationshipId: "assistant-1",
        relationshipType: "Assistant",
      });
    }
  });

  it("leaves the relationship unset when there is neither a scope nor a thread", async () => {
    const call = vi.fn(async () => ({ answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } }));
    await buildSut(call).execute({ state: { ...state, scopeId: undefined, scopeType: undefined } });

    // first pass + zero-tool-call retry: without this the loop below would pass
    // vacuously against zero calls.
    expect(call).toHaveBeenCalledTimes(2);
    for (const [args] of call.mock.calls) {
      expect(args.tokenUsageType).toBe("responder");
      expect(args.relationshipId).toBeUndefined();
      expect(args.relationshipType).toBeUndefined();
    }
  });
});
