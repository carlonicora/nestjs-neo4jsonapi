import { describe, expect, it, vi } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { GraphNodeService, walkedEdgeCount } from "../graph.node.service";
import type { ToolCallRecord } from "../../../graph/tools/tool.factory";

/**
 * The traversal guard is a DETECTOR: a current-state answer built without
 * walking an edge is logged and counted in the trace, never re-called.
 */

// Tools that feed the node's shared recorder, so the detector (which reads the
// recorder, not the tool results) can be exercised.
const recordingTool = (name: string, extra: Partial<ToolCallRecord> = {}) =>
  ({
    build: (_ctx: unknown, recorder: ToolCallRecord[]) =>
      new DynamicStructuredTool({
        name,
        description: name,
        schema: z.object({}).passthrough(),
        func: async (input: Record<string, unknown>) => {
          recorder.push({ tool: name, input, durationMs: 1, ...extra } as ToolCallRecord);
          return JSON.stringify({ ok: true });
        },
      }),
  }) as any;

const buildService = (llmCall: (args: any) => Promise<any>, config: Record<string, unknown>) => {
  const call = vi.fn(llmCall);
  const service = new GraphNodeService(
    { call } as any,
    { getTypeIndexFor: vi.fn(() => "- demo — anything") } as any,
    {} as any,
    recordingTool("resolve_entity"),
    { ...recordingTool("describe_entity"), renderCatalog: () => ({ text: "", types: [], approxTokens: 0 }) },
    recordingTool("search_entities"),
    recordingTool("read_entity"),
    recordingTool("traverse"),
    { get: vi.fn((key: string) => config[key]) } as any,
  );
  const warn = vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);
  return { service, call, warn };
};

const state = { companyId: "c", userId: "u", userModuleIds: ["m-1"], question: "q", chatHistory: [] } as any;
const guardOn = { responder: { graph: { requireTraversalBeforeAnswer: true } } };

describe("GraphNodeService — traversal detector", () => {
  it("does not call the model a second time when a pass walked no edge", async () => {
    const { service, call, warn } = buildService(async (args: any) => {
      await args.tools.find((t: any) => t.name === "read_entity").func({});
      return {
        basisKind: "current-state",
        relationshipsWalked: "",
        answer: "…",
        entities: [],
        tokenUsage: { input: 1, output: 1 },
      };
    }, guardOn);

    const result: any = await service.execute({ state });

    expect(call).toHaveBeenCalledTimes(1);
    const detectorWarn = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes("traversal detector"));
    expect(detectorWarn).toBeDefined();
    expect(detectorWarn).toContain("read_entity");
    expect(result.trace.graph.traversalDetector.fired).toBe(true);
    expect(result.trace.graph.traversalDetector.basisKind).toBe("current-state");
    expect(result.trace.graph.traversalDetector.edgesWalked).toBe(0);
  });

  it("counts read_entity with linked records as walking an edge", () => {
    expect(walkedEdgeCount([{ tool: "read_entity", walkedEdge: true, input: {}, durationMs: 1 }])).toBe(1);
  });

  it("counts successful traverse calls and ignores failed ones and plain reads", () => {
    expect(
      walkedEdgeCount([
        { tool: "traverse", input: {}, durationMs: 1 },
        { tool: "traverse", input: {}, durationMs: 1, error: "boom" },
        { tool: "read_entity", input: {}, durationMs: 1 },
        { tool: "read_entity", walkedEdge: true, input: {}, durationMs: 1, error: "boom" },
        { tool: "search_entities", input: {}, durationMs: 1 },
      ]),
    ).toBe(1);
  });

  it("does not fire when read_entity returned linked records", async () => {
    const { service, call, warn } = buildService(async (args: any) => {
      await args.tools.find((t: any) => t.name === "read_entity").func({});
      return {
        basisKind: "current-state",
        relationshipsWalked: "sessions",
        answer: "…",
        entities: [],
        tokenUsage: { input: 1, output: 1 },
      };
    }, guardOn);
    // Rebuild read_entity so its record carries walkedEdge.
    (service as any).readTool = recordingTool("read_entity", { walkedEdge: true });

    const result: any = await service.execute({ state });

    expect(call).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("traversal detector"))).toBe(false);
    expect(result.trace.graph.traversalDetector).toEqual({ fired: false, basisKind: "current-state", edgesWalked: 1 });
  });

  it("identity-only basis logs nothing", async () => {
    const { service, call, warn } = buildService(async (args: any) => {
      await args.tools.find((t: any) => t.name === "read_entity").func({});
      return {
        basisKind: "identity-only",
        relationshipsWalked: "",
        answer: "…",
        entities: [],
        tokenUsage: { input: 1, output: 1 },
      };
    }, guardOn);

    const result: any = await service.execute({ state });

    expect(call).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(result.trace.graph.traversalDetector.fired).toBe(false);
  });

  it("does not fire when the pass made no tool calls", async () => {
    const { service, warn } = buildService(
      async () => ({
        basisKind: "current-state",
        relationshipsWalked: "",
        answer: "…",
        entities: [],
        tokenUsage: { input: 1, output: 1 },
      }),
      guardOn,
    );

    const result: any = await service.execute({ state });

    expect(warn.mock.calls.some((c: any[]) => String(c[0]).includes("traversal detector"))).toBe(false);
    expect(result.trace.graph.traversalDetector.fired).toBe(false);
  });

  it("output schema carries the scaffold fields before answer when the guard is on", async () => {
    const seen: any[] = [];
    const { service } = buildService(async (args: any) => {
      seen.push(args);
      await args.tools.find((t: any) => t.name === "traverse").func({});
      return { basisKind: "current-state", relationshipsWalked: "x", answer: "…", entities: [], stop: true };
    }, guardOn);

    await service.execute({ state });

    expect(Object.keys(seen[0].outputSchema.shape).slice(0, 3)).toEqual(["basisKind", "relationshipsWalked", "answer"]);
  });

  it("output schema has no scaffold fields and the trace no detector when the guard is off", async () => {
    const seen: any[] = [];
    const { service } = buildService(async (args: any) => {
      seen.push(args);
      await args.tools.find((t: any) => t.name === "read_entity").func({});
      return { answer: "…", entities: [], stop: true };
    }, {});

    const result: any = await service.execute({ state });

    const keys = Object.keys(seen[0].outputSchema.shape);
    expect(keys).not.toContain("basisKind");
    expect(keys).not.toContain("relationshipsWalked");
    expect(result.trace.graph.traversalDetector).toBeUndefined();
  });

  it("keeps the scaffold fields out of the answer data", async () => {
    const { service } = buildService(async (args: any) => {
      await args.tools.find((t: any) => t.name === "traverse").func({});
      return {
        basisKind: "current-state",
        relationshipsWalked: "sessions",
        answer: "the answer",
        entities: [],
        tokenUsage: { input: 1, output: 1 },
      };
    }, guardOn);

    const result: any = await service.execute({ state });

    expect(result.graphContext.answer).toBe("the answer");
    expect("basisKind" in result.graphContext).toBe(false);
    expect("relationshipsWalked" in result.graphContext).toBe(false);
  });
});
