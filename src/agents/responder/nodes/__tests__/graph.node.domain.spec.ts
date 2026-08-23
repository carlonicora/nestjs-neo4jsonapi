import { describe, expect, it, vi } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  GraphNodeService,
  MAX_TOOL_ITERATIONS,
  RETRY_INSTRUCTION,
  TRAVERSAL_RETRY_INSTRUCTION,
} from "../graph.node.service";
import type { ToolCallRecord } from "../../../graph/tools/tool.factory";

const buildTool = (name: string) =>
  ({
    build: () =>
      new DynamicStructuredTool({
        name,
        description: name,
        schema: z.object({}).passthrough(),
        func: async () => JSON.stringify({}),
      }),
  }) as any;

const buildService = (llmCall: (args: any) => Promise<any>, prompts: unknown) =>
  new GraphNodeService(
    { call: vi.fn(llmCall) } as any,
    { getTypeIndexFor: vi.fn(() => "- demo — anything") } as any,
    {} as any,
    buildTool("resolve_entity"),
    buildTool("describe_entity"),
    buildTool("search_entities"),
    buildTool("read_entity"),
    buildTool("traverse"),
    { get: vi.fn(() => prompts) } as any,
  );

describe("GraphNodeService — domain layer", () => {
  it("passes the configured domain into the rendered system prompt", async () => {
    const seenPrompts: string[] = [];
    const service = buildService(
      async ({ systemPrompts }: any) => {
        seenPrompts.push(systemPrompts[0]);
        return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
      },
      { graphNodeDomain: { role: "ROLE_SLOT_MARKER." } },
    );

    await service.execute({
      state: { companyId: "c", userId: "u", userModuleIds: ["m-1"], question: "q", chatHistory: [] } as any,
    });

    expect(seenPrompts[0]).toContain("ROLE_SLOT_MARKER.");
    expect(seenPrompts[0]).not.toMatch(/\{DOMAIN_/);
  });

  it("renders the kernel defaults when config has no prompts block", async () => {
    const seenPrompts: string[] = [];
    const service = buildService(async ({ systemPrompts }: any) => {
      seenPrompts.push(systemPrompts[0]);
      return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
    }, undefined);

    await service.execute({
      state: { companyId: "c", userId: "u", userModuleIds: ["m-1"], question: "q", chatHistory: [] } as any,
    });

    expect(seenPrompts[0]).toContain("You help a user explore their organisation's data.");
  });
});

describe("RETRY_INSTRUCTION neutrality", () => {
  it("carries no ERP vocabulary", () => {
    expect(RETRY_INSTRUCTION).not.toMatch(/company/i);
    expect(RETRY_INSTRUCTION).not.toMatch(/customer/i);
    expect(RETRY_INSTRUCTION).not.toMatch(/work order/i);
  });

  it("traversal retry instruction is equally neutral", () => {
    expect(TRAVERSAL_RETRY_INSTRUCTION).not.toMatch(/company/i);
    expect(TRAVERSAL_RETRY_INSTRUCTION).not.toMatch(/customer/i);
    expect(TRAVERSAL_RETRY_INSTRUCTION).not.toMatch(/work order/i);
    expect(TRAVERSAL_RETRY_INSTRUCTION).not.toMatch(/\$\{/);
  });
});

// Tools that feed the node's shared recorder, so structural retry conditions
// (which read the recorder, not the tool results) can be exercised.
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

const buildTunedService = (llmCall: (args: any) => Promise<any>, config: Record<string, unknown>) =>
  new GraphNodeService(
    { call: vi.fn(llmCall) } as any,
    { getTypeIndexFor: vi.fn(() => "- demo — anything") } as any,
    {} as any,
    recordingTool("resolve_entity"),
    recordingTool("describe_entity"),
    recordingTool("search_entities"),
    recordingTool("read_entity"),
    recordingTool("traverse"),
    { get: vi.fn((key: string) => config[key]) } as any,
  );

const tunedState = { companyId: "c", userId: "u", userModuleIds: ["m-1"], question: "q", chatHistory: [] } as any;

describe("GraphNodeService — graph tuning knobs", () => {
  it("forwards responder.graph modelWeight and reasoningEffort to the llm call", async () => {
    const seen: any[] = [];
    const service = buildTunedService(
      async (args: any) => {
        seen.push(args);
        await args.tools.find((t: any) => t.name === "traverse").func({});
        return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
      },
      { responder: { graph: { modelWeight: "large", reasoningEffort: "medium" } } },
    );

    await service.execute({ state: tunedState });

    expect(seen).toHaveLength(1);
    expect(seen[0].modelWeight).toBe("large");
    expect(seen[0].reasoningEffort).toBe("medium");
  });

  it("passes neither knob when responder.graph is absent", async () => {
    const seen: any[] = [];
    const service = buildTunedService(async (args: any) => {
      seen.push(args);
      await args.tools.find((t: any) => t.name === "traverse").func({});
      return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
    }, {});

    await service.execute({ state: tunedState });

    expect("modelWeight" in seen[0]).toBe(false);
    expect("reasoningEffort" in seen[0]).toBe(false);
  });
});

describe("GraphNodeService — traversal guard", () => {
  it("retries once with the traversal instruction when tools ran but nothing traversed", async () => {
    const seen: any[] = [];
    const service = buildTunedService(
      async (args: any) => {
        seen.push(args);
        if (seen.length === 1) await args.tools.find((t: any) => t.name === "read_entity").func({});
        return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
      },
      { responder: { graph: { requireTraversalBeforeAnswer: true } } },
    );

    await service.execute({ state: tunedState });

    expect(seen).toHaveLength(2);
    expect(seen[1].systemPrompts[1]).toBe(TRAVERSAL_RETRY_INSTRUCTION);
  });

  it("prefers the domain traversalRetry override over the library default", async () => {
    const seen: any[] = [];
    const service = buildTunedService(
      async (args: any) => {
        seen.push(args);
        if (seen.length === 1) await args.tools.find((t: any) => t.name === "read_entity").func({});
        return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
      },
      {
        prompts: { graphNodeDomain: { traversalRetry: "CUSTOM_TRAVERSAL_RETRY." } },
        responder: { graph: { requireTraversalBeforeAnswer: true } },
      },
    );

    await service.execute({ state: tunedState });

    expect(seen).toHaveLength(2);
    expect(seen[1].systemPrompts[1]).toBe("CUSTOM_TRAVERSAL_RETRY.");
  });

  it("does not fire when a traverse succeeded", async () => {
    const seen: any[] = [];
    const service = buildTunedService(
      async (args: any) => {
        seen.push(args);
        await args.tools.find((t: any) => t.name === "traverse").func({});
        return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
      },
      { responder: { graph: { requireTraversalBeforeAnswer: true } } },
    );

    await service.execute({ state: tunedState });

    expect(seen).toHaveLength(1);
  });

  it("does not fire when the flag is off", async () => {
    const seen: any[] = [];
    const service = buildTunedService(async (args: any) => {
      seen.push(args);
      await args.tools.find((t: any) => t.name === "read_entity").func({});
      return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
    }, {});

    await service.execute({ state: tunedState });

    expect(seen).toHaveLength(1);
  });

  it("is skipped when the iteration budget is already spent", async () => {
    const seen: any[] = [];
    const service = buildTunedService(
      async (args: any) => {
        seen.push(args);
        const read = args.tools.find((t: any) => t.name === "read_entity");
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) await read.func({});
        return { answer: "…", entities: [], tokenUsage: { input: 1, output: 1 } };
      },
      { responder: { graph: { requireTraversalBeforeAnswer: true } } },
    );

    await service.execute({ state: tunedState });

    expect(seen).toHaveLength(1);
  });
});
