import { vi } from "vitest";
import { ChatbotService } from "../chatbot.service";

describe("ChatbotService", () => {
  const llmResponse = {
    answer: "The last order is #O1 for 100 EUR.",
    references: [{ type: "orders", id: "o1", reason: "Most recent order for Acme Corp" }],
    needsClarification: false,
    suggestedQuestions: ["What was the previous order?"],
  };
  const llmService: any = {
    call: vi.fn(async () => ({ ...llmResponse, tokenUsage: { input: 500, output: 100 } })),
  };
  const graphCatalog: any = {
    getMapFor: vi.fn((m: string[]) => (m.length ? `## Entities\n- accounts\n` : "")),
  };
  const factory: any = {};
  // capturedRecorder will point at the recorder array the service created on the most recent run().
  // Tool.build is called by the service with (ctx, recorder), so we capture it there and tests can push to it.
  let capturedRecorder: any[] = [];
  const tools = {
    describeEntity: {
      build: (_ctx: any, recorder: any[]) => {
        capturedRecorder = recorder;
        return { name: "describe_entity" };
      },
    },
    searchEntities: {
      build: (_ctx: any, recorder: any[]) => {
        capturedRecorder = recorder;
        return { name: "search_entities" };
      },
    },
    readEntity: {
      build: (_ctx: any, recorder: any[]) => {
        capturedRecorder = recorder;
        return { name: "read_entity" };
      },
    },
    traverse: {
      build: (_ctx: any, recorder: any[]) => {
        capturedRecorder = recorder;
        return { name: "traverse" };
      },
    },
  };
  const svc = new ChatbotService(
    llmService,
    graphCatalog,
    factory,
    tools.describeEntity as any,
    tools.searchEntities as any,
    tools.readEntity as any,
    tools.traverse as any,
  );

  beforeEach(() => {
    llmService.call.mockReset();
    llmService.call.mockImplementation(async () => ({ ...llmResponse, tokenUsage: { input: 500, output: 100 } }));
    graphCatalog.getMapFor.mockClear();
    capturedRecorder = [];
  });

  it("assembles system prompt with graph map and invokes LLM", async () => {
    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "What is the last order from Acme?" }],
    });
    expect(graphCatalog.getMapFor).toHaveBeenCalledWith(["crm"]);
    expect(llmService.call).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompts: expect.arrayContaining([expect.stringContaining("accounts")]),
        tools: expect.arrayContaining([{ name: "describe_entity" }]),
        maxToolIterations: 15,
        temperature: 0.1,
      }),
    );
    expect(out.answer).toBe("The last order is #O1 for 100 EUR.");
    expect(out.references).toHaveLength(1);
    expect(out.needsClarification).toBe(false);
    expect(out.tokens).toEqual({ input: 500, output: 100 });
  });

  it("returns clean refusal when userModules is empty", async () => {
    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: [],
      messages: [{ role: "user", content: "anything" }],
    });
    expect(out.answer).toMatch(/no accessible data|no enabled modules/i);
    expect(llmService.call).not.toHaveBeenCalled();
  });

  it("retries once when the LLM returns zero tool calls and zero references", async () => {
    const firstAttempt = {
      answer: "I cannot fulfill this request.",
      references: [],
      needsClarification: false,
      suggestedQuestions: [],
      tokenUsage: { input: 500, output: 50 },
    };
    const retry = {
      answer: "Found it.",
      references: [{ type: "accounts", id: "a1", reason: "resolved via search" }],
      needsClarification: false,
      suggestedQuestions: [],
      tokenUsage: { input: 600, output: 70 },
    };
    llmService.call.mockImplementationOnce(async () => firstAttempt).mockImplementationOnce(async () => retry);

    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "Tell me about Acme." }],
    });

    expect(llmService.call).toHaveBeenCalledTimes(2);
    expect(out.answer).toBe("Found it.");
    expect(out.references).toHaveLength(1);

    // First call has only the base system prompt.
    const firstCallArgs = llmService.call.mock.calls[0][0];
    expect(firstCallArgs.systemPrompts).toHaveLength(1);

    // Second call should carry the retry instruction as a second systemPrompts entry.
    const secondCallArgs = llmService.call.mock.calls[1][0];
    expect(secondCallArgs.systemPrompts).toHaveLength(2);
    expect(secondCallArgs.systemPrompts[1]).toMatch(/MUST call at least one tool/);
  });

  it("does NOT retry if the first attempt called at least one tool", async () => {
    // First attempt returns no references but the recorder got populated (simulating a tool call happened).
    llmService.call.mockImplementationOnce(async () => {
      capturedRecorder.push({ tool: "search_entities", args: {}, result: {} } as any);
      return {
        answer: "No matches found.",
        references: [],
        needsClarification: false,
        suggestedQuestions: [],
        tokenUsage: { input: 500, output: 50 },
      };
    });

    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "Find something." }],
    });

    expect(llmService.call).toHaveBeenCalledTimes(1);
    expect(out.answer).toBe("No matches found.");
    expect(out.toolCalls).toHaveLength(1);
  });

  it("does NOT retry if the first attempt returned references", async () => {
    llmService.call.mockImplementationOnce(async () => ({
      answer: "Here's what I found.",
      references: [{ type: "accounts", id: "a1", reason: "from prior context" }],
      needsClarification: false,
      suggestedQuestions: [],
      tokenUsage: { input: 500, output: 50 },
    }));

    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "Tell me about that account." }],
    });

    expect(llmService.call).toHaveBeenCalledTimes(1);
    expect(out.answer).toBe("Here's what I found.");
    expect(out.references).toHaveLength(1);
  });

});
