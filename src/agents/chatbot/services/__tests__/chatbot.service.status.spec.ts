import { vi } from "vitest";
import { ChatbotService } from "../chatbot.service";

describe("ChatbotService — assistant:status socket events", () => {
  const llmResponse = {
    answer: "Found Acme Corp.",
    references: [{ type: "accounts", id: "a1", reason: "Matched search query" }],
    needsClarification: false,
    suggestedQuestions: [],
    tokenUsage: { input: 400, output: 80 },
  };

  const graphCatalog: any = {
    getMapFor: vi.fn((m: string[]) => (m.length ? `## Entities\n- accounts\n` : "")),
  };

  const factory: any = {};

  // Tool stubs — each build() returns an object with name AND func so the llm stub can invoke them.
  const tools = {
    resolveEntity: {
      build: (_ctx: any, _recorder: any[]) => ({
        name: "resolve_entity",
        func: async (_input: any) => JSON.stringify({ matchMode: "none", items: [] }),
      }),
    },
    describeEntity: {
      build: (_ctx: any, _recorder: any[]) => ({
        name: "describe_entity",
        func: async (_input: any) => JSON.stringify({ ok: true }),
      }),
    },
    searchEntities: {
      build: (_ctx: any, _recorder: any[]) => ({
        name: "search_entities",
        func: async (_input: any) => JSON.stringify({ ok: true }),
      }),
    },
    readEntity: {
      build: (_ctx: any, _recorder: any[]) => ({
        name: "read_entity",
        func: async (_input: any) => JSON.stringify({ ok: true }),
      }),
    },
    traverse: {
      build: (_ctx: any, _recorder: any[]) => ({
        name: "traverse",
        func: async (_input: any) => JSON.stringify({ ok: true }),
      }),
    },
  };

  // ---------------------------------------------------------------------------
  // Test 1 — emits assistant:status with assistantId during a tool call
  // ---------------------------------------------------------------------------
  // The ws stub will be passed as the 8th (optional) constructor arg — Task 15
  // wires it up. We cast the constructor to `any` to avoid the TS error that
  // arises because ChatbotService currently declares only 7 args.
  it("emits assistant:status with assistantId when a tool is invoked", async () => {
    const ws: any = { sendMessageToUser: vi.fn() };

    // llm.call simulates the LLM invoking the search_entities tool once, then
    // returning the final response. Task 17 wraps each tool's func with a
    // pre-emit to ws.sendMessageToUser — that pre-emit is what this test asserts.
    const llmService: any = {
      call: vi.fn(async (args: any) => {
        const searchTool = (args.tools as any[]).find((t: any) => t.name === "search_entities");
        if (searchTool?.func) {
          await searchTool.func({ type: "accounts", text: "Acme" });
        }
        return { ...llmResponse };
      }),
    };

    // Construct with the 8th optional ws arg — Task 14 adds assistantId to
    // ChatbotRunParams; Task 15 adds the ws constructor param. Until then we
    // cast to bypass TS's 7-arg check.
    const svc = new (ChatbotService as any)(
      llmService,
      graphCatalog,
      factory,
      tools.resolveEntity as any,
      tools.describeEntity as any,
      tools.searchEntities as any,
      tools.readEntity as any,
      tools.traverse as any,
      ws,
    ) as ChatbotService;

    // Task 14 adds assistantId to ChatbotRunParams — cast until then.
    await svc.run(
      {
        companyId: "c1",
        userId: "u1",
        userModuleIds: ["crm"],
        messages: [{ role: "user", content: "Find Acme" }],
        assistantId: "a-123",
      } as any /* Task 14 adds assistantId to ChatbotRunParams */,
    );

    expect(ws.sendMessageToUser).toHaveBeenCalledWith(
      "u1",
      "assistant:status",
      expect.objectContaining({
        assistantId: "a-123",
        status: expect.stringContaining("Searching"),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2 — no-ops gracefully when ws is not injected (regression guard)
  // ---------------------------------------------------------------------------
  it("resolves without throwing when ws is not injected", async () => {
    const llmService: any = {
      call: vi.fn(async () => ({ ...llmResponse })),
    };

    // Standard 8-arg construction — no ws.
    const svc = new ChatbotService(
      llmService,
      graphCatalog,
      factory,
      tools.resolveEntity as any,
      tools.describeEntity as any,
      tools.searchEntities as any,
      tools.readEntity as any,
      tools.traverse as any,
    );

    // Task 14 adds assistantId to ChatbotRunParams — cast until then.
    const result = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModuleIds: ["crm"],
      messages: [{ role: "user", content: "Find Acme" }],
    } as any);

    expect(result).toBeDefined();
    expect(result.answer).toBe("Found Acme Corp.");
  });
});
