import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { GraphNodeService, MAX_TOOL_ITERATIONS } from "../../../responder/nodes/graph.node.service";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { GraphCatalogService } from "../graph.catalog.service";
import { ToolFactory } from "../../tools/tool.factory";
import { ResolveEntityTool } from "../../tools/resolve-entity.tool";
import { DescribeEntityTool } from "../../tools/describe-entity.tool";
import { SearchEntitiesTool } from "../../tools/search-entities.tool";
import { ReadEntityTool } from "../../tools/read-entity.tool";
import { TraverseTool } from "../../tools/traverse.tool";

function fakeTool(name: string) {
  return new DynamicStructuredTool({
    name,
    description: name,
    schema: z.object({}).strict(),
    func: async () => "ok",
  });
}

describe("GraphNodeService", () => {
  let service: GraphNodeService;
  const llm = { call: vi.fn() } as unknown as LLMService;
  const catalog = { getMapFor: vi.fn().mockReturnValue("ENTITY CATALOG TEXT") } as unknown as GraphCatalogService;
  const toolFactory = {} as ToolFactory;
  const mkBuild = (name: string) => ({ build: vi.fn().mockReturnValue(fakeTool(name)) });
  const resolveTool = mkBuild("resolve_entity") as unknown as ResolveEntityTool;
  const describeTool = mkBuild("describe_entity") as unknown as DescribeEntityTool;
  const searchTool = mkBuild("search_entities") as unknown as SearchEntitiesTool;
  const readTool = mkBuild("read_entity") as unknown as ReadEntityTool;
  const traverseTool = mkBuild("traverse") as unknown as TraverseTool;

  beforeEach(async () => {
    vi.clearAllMocks();
    (catalog.getMapFor as unknown as Mock).mockReturnValue("ENTITY CATALOG TEXT");
    // reset each tool's build to return a fresh fakeTool by default
    (resolveTool.build as unknown as Mock).mockImplementation(() => fakeTool("resolve_entity"));
    (describeTool.build as unknown as Mock).mockImplementation(() => fakeTool("describe_entity"));
    (searchTool.build as unknown as Mock).mockImplementation(() => fakeTool("search_entities"));
    (readTool.build as unknown as Mock).mockImplementation(() => fakeTool("read_entity"));
    (traverseTool.build as unknown as Mock).mockImplementation(() => fakeTool("traverse"));

    const moduleRef = await Test.createTestingModule({
      providers: [
        GraphNodeService,
        { provide: LLMService, useValue: llm },
        { provide: GraphCatalogService, useValue: catalog },
        { provide: ToolFactory, useValue: toolFactory },
        { provide: ResolveEntityTool, useValue: resolveTool },
        { provide: DescribeEntityTool, useValue: describeTool },
        { provide: SearchEntitiesTool, useValue: searchTool },
        { provide: ReadEntityTool, useValue: readTool },
        { provide: TraverseTool, useValue: traverseTool },
      ],
    }).compile();
    service = moduleRef.get(GraphNodeService);
  });

  it("returns success with entities, recorder, and tokens when LLM resolves cleanly", async () => {
    let capturedRecorder: any[] = [];
    (resolveTool.build as unknown as Mock).mockImplementation((_ctx, recorder) => {
      capturedRecorder = recorder;
      return fakeTool("resolve_entity");
    });

    (llm.call as unknown as Mock).mockImplementation(async () => {
      // Simulate the LLM having actually called tools so the honesty-rewrite
      // path doesn't fire after the initial call.
      capturedRecorder.push({ tool: "resolve_entity", input: { text: "Acme" }, durationMs: 1 });
      return {
        answer: "Acme Corp has one open order: ORD-2026-0001.",
        entities: [
          {
            type: "Account",
            id: "acc-1",
            reason: "the account asked about",
            fields: { name: "Acme Corp", country_code: "GB" },
          },
          {
            type: "Order",
            id: "ord-1",
            reason: "an order on that account",
            fields: { number: "ORD-2026-0001", status: "open" },
          },
        ],
        stop: true,
        tokenUsage: { input: 100, output: 50 },
      };
    });

    const out = await service.execute({
      state: {
        companyId: "co-1",
        userId: "user-1",
        userModuleIds: ["mod-1"],
        rawQuestion: "What about Acme?",
        question: "What about Acme?",
        chatHistory: [],
        contentId: undefined,
        contentType: undefined,
      } as any,
    });

    expect(out.graphContext?.status).toBe("success");
    expect(out.graphContext?.entities.length).toBe(2);
    for (const e of out.graphContext!.entities) {
      expect(typeof e.foundAtHop).toBe("number");
    }
    expect(out.graphContext?.entities[0].fields).toEqual({ name: "Acme Corp", country_code: "GB" });
    expect(out.graphContext?.entities[1].fields).toEqual({ number: "ORD-2026-0001", status: "open" });
    expect(out.graphContext?.toolCalls).toBe(capturedRecorder);
    expect(out.graphContext?.tokens).toEqual({ input: 100, output: 50 });
    expect(out.graphError).toBeNull();
    expect((out.trace as any)?.graph?.entitiesDiscovered).toBe(2);
    expect(out.graphContext?.answer).toBe("Acme Corp has one open order: ORD-2026-0001.");
  });

  it("omits fields on entities returned without them (context-only matches)", async () => {
    let capturedRecorder: any[] = [];
    (resolveTool.build as unknown as Mock).mockImplementation((_ctx, recorder) => {
      capturedRecorder = recorder;
      return fakeTool("resolve_entity");
    });

    (llm.call as unknown as Mock).mockImplementation(async () => {
      capturedRecorder.push({ tool: "resolve_entity", input: { text: "x" }, durationMs: 1 });
      return {
        answer: "Two accounts matched but neither carried quotable data.",
        entities: [
          { type: "Account", id: "acc-2", reason: "context only" },
          { type: "Account", id: "acc-3", reason: "empty fields", fields: {} },
        ],
        stop: true,
        tokenUsage: { input: 1, output: 1 },
      };
    });

    const out = await service.execute({
      state: {
        companyId: "co-1",
        userId: "user-1",
        userModuleIds: ["mod-1"],
        rawQuestion: "x",
        question: "x",
        chatHistory: [],
      } as any,
    });

    expect(out.graphContext?.entities[0].fields).toBeUndefined();
    expect(out.graphContext?.entities[1].fields).toBeUndefined();
  });

  it("skips when userModuleIds is empty", async () => {
    const out = await service.execute({
      state: {
        companyId: "co-1",
        userId: "user-1",
        userModuleIds: [],
        rawQuestion: "Hello",
        question: "Hello",
        chatHistory: [],
        contentId: undefined,
        contentType: undefined,
      } as any,
    });

    expect(out.graphContext?.status).toBe("skipped_no_modules");
    expect(llm.call).not.toHaveBeenCalled();
    expect(out.graphContext?.entities.length).toBe(0);
    expect(out.graphContext?.tokens).toEqual({ input: 0, output: 0 });
    expect(out.graphContext?.answer).toBe("");
  });

  it("returns partial when the recorder has reached MAX_TOOL_ITERATIONS", async () => {
    let capturedRecorder: any[] = [];
    (resolveTool.build as unknown as Mock).mockImplementation((_ctx, recorder) => {
      capturedRecorder = recorder;
      return fakeTool("resolve_entity");
    });

    (llm.call as unknown as Mock).mockImplementation(async () => {
      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        capturedRecorder.push({ tool: "resolve_entity", input: {}, durationMs: 1 });
      }
      return {
        answer: "",
        entities: [],
        stop: false,
        tokenUsage: { input: 5, output: 2 },
      };
    });

    const out = await service.execute({
      state: {
        companyId: "co-1",
        userId: "user-1",
        userModuleIds: ["mod-1"],
        rawQuestion: "What about Acme?",
        question: "What about Acme?",
        chatHistory: [],
        contentId: undefined,
        contentType: undefined,
      } as any,
    });

    expect(out.graphContext?.status).toBe("partial");
  });

  it("returns failed when LLM rejects", async () => {
    (llm.call as unknown as Mock).mockRejectedValue(new Error("LLM exploded"));

    const out = await service.execute({
      state: {
        companyId: "co-1",
        userId: "user-1",
        userModuleIds: ["mod-1"],
        rawQuestion: "What about Acme?",
        question: "What about Acme?",
        chatHistory: [],
        contentId: undefined,
        contentType: undefined,
      } as any,
    });

    expect(out.graphContext?.status).toBe("failed");
    expect(out.graphContext?.errorMessage).toBe("LLM exploded");
    expect(out.graphError).toBe("LLM exploded");
    expect(out.graphContext?.entities.length).toBe(0);
    expect(out.graphContext?.answer).toBe("");
  });

  it("zero-tool-call retry: empty recorder on first call triggers a second LLM call with the RETRY_INSTRUCTION system prompt", async () => {
    let capturedRecorder: any[] = [];
    (resolveTool.build as unknown as Mock).mockImplementation((_ctx, recorder) => {
      capturedRecorder = recorder;
      return fakeTool("resolve_entity");
    });

    (llm.call as unknown as Mock)
      .mockResolvedValueOnce({
        answer: "I cannot tell without looking it up.",
        entities: [],
        stop: true,
        tokenUsage: { input: 10, output: 5 },
      })
      .mockImplementationOnce(async () => {
        capturedRecorder.push({ tool: "resolve_entity", input: { text: "Acme" }, durationMs: 1 });
        return {
          answer: "Acme is an account.",
          entities: [{ type: "accounts", id: "acc-1", reason: "matched" }],
          stop: true,
          tokenUsage: { input: 30, output: 15 },
        };
      });

    const out = await service.execute({
      state: {
        companyId: "co-1",
        userId: "user-1",
        userModuleIds: ["mod-1"],
        rawQuestion: "What is Acme?",
        question: "What is Acme?",
        chatHistory: [],
      } as any,
    });

    expect((llm.call as unknown as Mock).mock.calls.length).toBe(2);
    const secondCallArgs = (llm.call as unknown as Mock).mock.calls[1][0];
    expect(secondCallArgs.systemPrompts.length).toBe(2);
    expect(secondCallArgs.systemPrompts[1]).toMatch(/did not call any tools/i);
    expect(secondCallArgs.systemPrompts[1]).toMatch(/resolve_entity/);
    expect(out.graphContext?.answer).toBe("Acme is an account.");
  });

  it("error-recovery retry: failed tool call + apologetic answer triggers a retry with the failing call quoted", async () => {
    let capturedRecorder: any[] = [];
    (resolveTool.build as unknown as Mock).mockImplementation((_ctx, recorder) => {
      capturedRecorder = recorder;
      return fakeTool("resolve_entity");
    });

    (llm.call as unknown as Mock)
      .mockImplementationOnce(async () => {
        capturedRecorder.push({
          tool: "search_entities",
          input: { type: "orders", filters: [{ field: "bogus", op: "eq", value: 1 }] },
          durationMs: 5,
          error: "unknown field 'bogus' on orders. Valid fields: number, status, total_amount.",
        });
        return {
          answer: "I am sorry, I could not retrieve the orders for you.",
          entities: [],
          stop: true,
          tokenUsage: { input: 50, output: 20 },
        };
      })
      .mockResolvedValueOnce({
        answer: "Found one open order, ORD-2026-0001.",
        entities: [{ type: "orders", id: "o-1", reason: "open order on the account" }],
        stop: true,
        tokenUsage: { input: 80, output: 30 },
      });

    const out = await service.execute({
      state: {
        companyId: "co-1",
        userId: "user-1",
        userModuleIds: ["mod-1"],
        rawQuestion: "List open orders",
        question: "List open orders",
        chatHistory: [],
      } as any,
    });

    expect((llm.call as unknown as Mock).mock.calls.length).toBe(2);
    const secondCallArgs = (llm.call as unknown as Mock).mock.calls[1][0];
    expect(secondCallArgs.systemPrompts.length).toBe(2);
    expect(secondCallArgs.systemPrompts[1]).toMatch(/A previous tool call failed/);
    expect(secondCallArgs.systemPrompts[1]).toContain("search_entities");
    expect(secondCallArgs.systemPrompts[1]).toContain("unknown field 'bogus'");
    expect(out.graphContext?.answer).toBe("Found one open order, ORD-2026-0001.");
  });

  it("honesty rewrite: still zero tool calls after retry → answer replaced with explicit failure, no third LLM call", async () => {
    (llm.call as unknown as Mock)
      .mockResolvedValueOnce({
        answer: "I think the answer is X.",
        entities: [{ type: "accounts", id: "a-1", reason: "guessed" }],
        stop: true,
        tokenUsage: { input: 10, output: 5 },
      })
      .mockResolvedValueOnce({
        answer: "Still going to guess: X.",
        entities: [{ type: "accounts", id: "a-1", reason: "guessed again" }],
        stop: true,
        tokenUsage: { input: 12, output: 6 },
      });

    const out = await service.execute({
      state: {
        companyId: "co-1",
        userId: "user-1",
        userModuleIds: ["mod-1"],
        rawQuestion: "Tell me about Acme",
        question: "Tell me about Acme",
        chatHistory: [],
      } as any,
    });

    expect((llm.call as unknown as Mock).mock.calls.length).toBe(2);
    expect(out.graphContext?.answer).toMatch(/I was unable to answer this question/);
    expect(out.graphContext?.answer).toMatch(/did not call any tool/);
    expect(out.graphContext?.entities.length).toBe(0);
  });
});
