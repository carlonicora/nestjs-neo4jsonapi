import { describe, expect, it, vi } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { GraphNodeService, RETRY_INSTRUCTION } from "../graph.node.service";

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
});
