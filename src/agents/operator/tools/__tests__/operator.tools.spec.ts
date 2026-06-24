import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolFactory, ToolCallRecord } from "../../../graph/tools/tool.factory";
import {
  OperatorRetrievalContext,
  OperatorToolCallRecord,
  OperatorToolContribution,
  OperatorToolDefinition,
} from "../../interfaces/operator.tool.interface";
import { SearchDocumentsTool } from "../search-documents.tool";
import { SearchCommunitiesTool } from "../search-communities.tool";
import { OperatorTestActionTool } from "../operator-test-action.tool";
import { OperatorToolRegistry } from "../operator.tool.registry";

// Real capture wrapper, dependencies unused by capture().
const factory = new ToolFactory({} as any, {} as any);

const ctx: OperatorRetrievalContext = {
  companyId: "company-1",
  userId: "user-1",
  userModuleIds: ["module-1"],
  contentId: "content-1",
  contentType: "documents",
  dataLimits: {} as any,
  messages: [],
};

function stubGraphTool(name: string) {
  return {
    build: (_ctx: any, _recorder: ToolCallRecord[]) =>
      new DynamicStructuredTool({
        name,
        description: `stub ${name}`,
        schema: z.object({}),
        func: async () => "{}",
      }),
  } as any;
}

describe("SearchDocumentsTool", () => {
  const contextualiserState = {
    notebook: [
      { chunkId: "chunk-1", content: "Acme signed the contract in March." },
      { chunkId: "chunk-2", content: "The contract renews yearly." },
    ],
    tokens: { input: 10, output: 20 },
    hops: 2,
  };

  it("invokes ContextualiserService with the responder-parity params", async () => {
    const run = vi.fn().mockResolvedValue(contextualiserState);
    const tool = new SearchDocumentsTool(factory, { run } as any);
    const recorder: ToolCallRecord[] = [];

    await tool.invoke({ question: "When did Acme sign?" }, ctx, recorder);

    expect(run).toHaveBeenCalledWith({
      companyId: "company-1",
      contentId: "content-1",
      contentType: "documents",
      dataLimits: ctx.dataLimits,
      messages: ctx.messages,
      question: "When did Acme sign?",
    });
  });

  it("defaults contentId/contentType to empty strings like the responder branch", async () => {
    const run = vi.fn().mockResolvedValue(contextualiserState);
    const tool = new SearchDocumentsTool(factory, { run } as any);

    await tool.invoke({ question: "q" }, { ...ctx, contentId: undefined, contentType: undefined }, []);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ contentId: "", contentType: "" }));
  });

  it("returns the retrieved answer text and records chunk citations into the recorder", async () => {
    const run = vi.fn().mockResolvedValue(contextualiserState);
    const tool = new SearchDocumentsTool(factory, { run } as any);
    const recorder: OperatorToolCallRecord[] = [];

    const answer = await tool.invoke({ question: "When did Acme sign?" }, ctx, recorder);

    expect(answer).toContain("Acme signed the contract in March.");
    expect(answer).toContain("The contract renews yearly.");
    expect(recorder).toHaveLength(1);
    expect(recorder[0].tool).toBe("search_documents");
    expect(recorder[0].citations).toEqual([
      { chunkId: "chunk-1", relevance: 100 },
      { chunkId: "chunk-2", relevance: 100 },
    ]);
  });

  it("returns a no-information message when the notebook is empty, without citations", async () => {
    const run = vi.fn().mockResolvedValue({ ...contextualiserState, notebook: [] });
    const tool = new SearchDocumentsTool(factory, { run } as any);
    const recorder: OperatorToolCallRecord[] = [];

    const answer = await tool.invoke({ question: "q" }, ctx, recorder);

    expect(answer).toMatch(/no information/i);
    expect(recorder).toHaveLength(1);
    expect(recorder[0].citations).toBeUndefined();
  });

  it("attaches citations to its own record even when a foreign record interleaves mid-flight", async () => {
    let resolveRun!: (state: unknown) => void;
    const run = vi.fn().mockReturnValue(new Promise((resolve) => (resolveRun = resolve)));
    const tool = new SearchDocumentsTool(factory, { run } as any);
    const recorder: OperatorToolCallRecord[] = [];

    const pending = tool.invoke({ question: "When did Acme sign?" }, ctx, recorder);
    // Another concurrently-running tool pushes its record into the shared recorder
    // between this invocation's start and completion.
    recorder.push({ tool: "other_tool", input: {}, durationMs: 1 });
    resolveRun(contextualiserState);
    await pending;

    expect(recorder.map((r) => r.tool)).toEqual(["other_tool", "search_documents"]);
    expect(recorder[0].citations).toBeUndefined();
    expect(recorder[1].citations).toEqual([
      { chunkId: "chunk-1", relevance: 100 },
      { chunkId: "chunk-2", relevance: 100 },
    ]);
  });

  it("records the failure in the recorder when the contextualiser throws", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    const tool = new SearchDocumentsTool(factory, { run } as any);
    const recorder: ToolCallRecord[] = [];

    await expect(tool.invoke({ question: "q" }, ctx, recorder)).rejects.toThrow("boom");
    expect(recorder).toHaveLength(1);
    expect(recorder[0].error).toBe("boom");
  });

  it("build() produces a DynamicStructuredTool named search_documents returning the answer text", async () => {
    const run = vi.fn().mockResolvedValue(contextualiserState);
    const tool = new SearchDocumentsTool(factory, { run } as any);
    const recorder: ToolCallRecord[] = [];

    const dst = tool.build(ctx, recorder);
    expect(dst.name).toBe("search_documents");

    const out = await dst.invoke({ question: "When did Acme sign?" });
    expect(out).toContain("Acme signed the contract in March.");
  });
});

describe("SearchCommunitiesTool", () => {
  it("returns the drift answer text and records the call", async () => {
    const search = vi.fn().mockResolvedValue({ answer: "Communities say hello.", matchedCommunities: [] });
    const tool = new SearchCommunitiesTool(factory, { search } as any);
    const recorder: ToolCallRecord[] = [];

    const answer = await tool.invoke({ question: "What do communities say?" }, recorder);

    expect(search).toHaveBeenCalledWith({ question: "What do communities say?" });
    expect(answer).toBe("Communities say hello.");
    expect(recorder).toHaveLength(1);
    expect(recorder[0].tool).toBe("search_communities");
  });

  it("returns an explicit no-information message when drift yields no answer", async () => {
    for (const answer of [undefined, ""]) {
      const search = vi.fn().mockResolvedValue({ answer, matchedCommunities: [] });
      const tool = new SearchCommunitiesTool(factory, { search } as any);

      const out = await tool.invoke({ question: "q" }, []);

      expect(out).toMatch(/no information/i);
      expect(out).not.toBe("");
    }
  });

  it("build() produces a DynamicStructuredTool named search_communities", async () => {
    const search = vi.fn().mockResolvedValue({ answer: "ok" });
    const tool = new SearchCommunitiesTool(factory, { search } as any);

    const dst = tool.build([]);
    expect(dst.name).toBe("search_communities");
    expect(await dst.invoke({ question: "q" })).toBe("ok");
  });
});

describe("OperatorTestActionTool", () => {
  it("is destructive and provides a summarise line", () => {
    const tool = new OperatorTestActionTool(factory);
    const definition = tool.buildDefinition([]);

    expect(definition.destructive).toBe(true);
    expect(definition.tool.name).toBe("operator_test_action");
    expect(definition.summarise).toBeDefined();
    expect(definition.summarise!({ note: "ping" })).toBe("Run test action: ping");
  });

  it("echoes its note as executed and records the call", async () => {
    const tool = new OperatorTestActionTool(factory);
    const recorder: ToolCallRecord[] = [];
    const definition = tool.buildDefinition(recorder);

    const out = await definition.tool.invoke({ note: "ping" });

    expect(out).toBe("Executed test action: ping");
    expect(recorder).toHaveLength(1);
    expect(recorder[0].tool).toBe("operator_test_action");
  });
});

describe("OperatorToolRegistry", () => {
  const graphToolNames = ["resolve_entity", "describe_entity", "search_entities", "read_entity", "traverse"];

  function buildRegistry(contributed?: OperatorToolContribution[]) {
    const contextualiser = { run: vi.fn().mockResolvedValue({ notebook: [] }) } as any;
    const drift = { search: vi.fn().mockResolvedValue({ answer: "" }) } as any;
    return new OperatorToolRegistry(
      stubGraphTool("resolve_entity"),
      stubGraphTool("describe_entity"),
      stubGraphTool("search_entities"),
      stubGraphTool("read_entity"),
      stubGraphTool("traverse"),
      new SearchDocumentsTool(factory, contextualiser),
      new SearchCommunitiesTool(factory, drift),
      new OperatorTestActionTool(factory),
      contributed,
    );
  }

  it("composes the five graph tools, the two retrieval tools and the test tool", () => {
    const definitions = buildRegistry().build(ctx, []);

    const names = definitions.map((d) => d.tool.name);
    expect(names).toEqual([...graphToolNames, "search_documents", "search_communities", "operator_test_action"]);

    for (const definition of definitions) {
      if (definition.tool.name === "operator_test_action") {
        expect(definition.destructive).toBe(true);
      } else {
        expect(definition.destructive).toBe(false);
      }
    }
  });

  it("builds OPERATOR_TOOLS contributions per turn with the ctx and recorder, appended after the built-ins", () => {
    const contributedDefinition: OperatorToolDefinition = {
      tool: new DynamicStructuredTool({
        name: "app_tool",
        description: "contributed by the app",
        schema: z.object({}),
        func: async () => "ok",
      }),
      destructive: true,
      summarise: () => "Run app tool",
    };
    const build = vi.fn().mockReturnValue(contributedDefinition);
    const recorder: ToolCallRecord[] = [];

    const definitions = buildRegistry([{ build }]).build(ctx, recorder);

    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(ctx, recorder);
    expect(definitions[definitions.length - 1]).toBe(contributedDefinition);
    expect(definitions.map((d) => d.tool.name)).toContain("app_tool");
  });

  it("rebuilds contributions on every turn so each gets that turn's ctx and recorder", () => {
    const build = vi.fn((_ctx: OperatorRetrievalContext, _recorder: ToolCallRecord[]) => ({
      tool: new DynamicStructuredTool({
        name: "app_tool",
        description: "contributed by the app",
        schema: z.object({}),
        func: async () => "ok",
      }),
      destructive: false,
    }));
    const registry = buildRegistry([{ build }]);

    const firstRecorder: ToolCallRecord[] = [];
    const secondCtx = { ...ctx, companyId: "company-2" };
    const secondRecorder: ToolCallRecord[] = [];
    registry.build(ctx, firstRecorder);
    registry.build(secondCtx, secondRecorder);

    expect(build).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenNthCalledWith(1, ctx, firstRecorder);
    expect(build).toHaveBeenNthCalledWith(2, secondCtx, secondRecorder);
  });

  it("contributed tools using capture() record their calls into the shared recorder", async () => {
    const contribution: OperatorToolContribution = {
      build: (builtCtx, recorder) => ({
        tool: new DynamicStructuredTool({
          name: "app_tool",
          description: "contributed by the app",
          schema: z.object({}),
          func: async (input) =>
            factory.capture({ tool: "app_tool", input }, async () => `scoped to ${builtCtx.companyId}`, recorder),
        }),
        destructive: false,
      }),
    };
    const recorder: ToolCallRecord[] = [];

    const definitions = buildRegistry([contribution]).build(ctx, recorder);
    const appTool = definitions.find((d) => d.tool.name === "app_tool")!;
    const out = await appTool.tool.invoke({});

    expect(out).toBe("scoped to company-1");
    expect(recorder).toHaveLength(1);
    expect(recorder[0].tool).toBe("app_tool");
  });

  it("throws a descriptive error when a contributed tool name collides with a built-in", () => {
    const contribution: OperatorToolContribution = {
      build: () => ({
        tool: new DynamicStructuredTool({
          name: "search_documents",
          description: "shadows a built-in",
          schema: z.object({}),
          func: async () => "ok",
        }),
        destructive: false,
      }),
    };

    expect(() => buildRegistry([contribution]).build(ctx, [])).toThrow(/duplicate tool name "search_documents"/);
  });

  it("omits operator_test_action when NODE_ENV is production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const definitions = buildRegistry().build(ctx, []);
      expect(definitions.map((d) => d.tool.name)).not.toContain("operator_test_action");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("passes the shared recorder to every built tool", async () => {
    const recorder: ToolCallRecord[] = [];
    const definitions = buildRegistry().build(ctx, recorder);

    const docs = definitions.find((d) => d.tool.name === "search_documents")!;
    const test = definitions.find((d) => d.tool.name === "operator_test_action")!;

    await docs.tool.invoke({ question: "q" });
    await test.tool.invoke({ note: "n" });

    expect(recorder.map((r) => r.tool)).toEqual(["search_documents", "operator_test_action"]);
  });
});
