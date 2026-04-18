import { beforeAll, describe, expect, it, vi } from "vitest";
import { AssistantService } from "../../services/assistant.service";
import { ChatbotService, ChatbotRunParams } from "../../../../agents/chatbot/services/chatbot.service";

/**
 * Scripted-LLM integration: exercises the full AssistantService lifecycle
 * (create → append) against in-memory repo + in-memory chatbot stubs. Asserts
 * the key behavioural contract: a 2nd turn gets a reference-memory system
 * message derived from the 1st turn's references.
 *
 * Standard CRUD (find / findById / patch / delete) is provided by
 * AbstractService and exercised through the framework's test suite — this
 * integration focuses on the non-standard agent-turn flow.
 */
describe("Assistant lifecycle (integration, scripted agent)", () => {
  let service: AssistantService;
  let storage: Map<string, any>;
  let chatbotRunParams: ChatbotRunParams[];

  beforeAll(() => {
    storage = new Map();
    chatbotRunParams = [];

    const repo = {
      create: vi.fn(async (params: any) => {
        storage.set(params.id, {
          id: params.id,
          type: "assistants",
          title: params.title,
          messages: params.messages,
          company: { id: "c" },
          createdAt: new Date(),
          updatedAt: new Date(),
          owner: { id: "u-1" },
        });
      }),
      patch: vi.fn(async (params: any) => {
        const existing = storage.get(params.id);
        if (!existing) throw new Error(`Not found: ${params.id}`);
        storage.set(params.id, {
          ...existing,
          ...(params.messages !== undefined ? { messages: params.messages } : {}),
          ...(params.title !== undefined ? { title: params.title } : {}),
          updatedAt: new Date(),
        });
      }),
      delete: vi.fn(async (params: any) => {
        storage.delete(params.id);
      }),
      findById: vi.fn(async (params: any) => {
        const entity = storage.get(params.id);
        if (!entity) throw new Error(`Not found: ${params.id}`);
        return entity;
      }),
      find: vi.fn(async () => Array.from(storage.values())),
    } as any;

    const userModules = { findModulesForRoles: vi.fn(async () => ["crm"]) } as any;

    // Scripted chatbot — turn 1 returns a reference; turn 2 asserts hydration was passed.
    let turn = 0;
    const chatbot = {
      run: vi.fn(async (params: ChatbotRunParams) => {
        chatbotRunParams.push({
          ...params,
          messages: params.messages.map((m) => ({ ...m })),
        });
        turn += 1;
        if (turn === 1) {
          return {
            type: "assistant",
            answer: "Acme is the top account.",
            references: [{ type: "accounts", id: "acc-1", reason: "primary match" }],
            needsClarification: false,
            suggestedQuestions: [],
            tokens: { input: 100, output: 50 },
            toolCalls: [{ tool: "search_entities", input: {}, durationMs: 10 }],
          };
        }
        return {
          type: "assistant",
          answer: "Its latest order is #ord-1 for 1000.",
          references: [{ type: "orders", id: "ord-1", reason: "latest order" }],
          needsClarification: false,
          suggestedQuestions: [],
          tokens: { input: 120, output: 60 },
          toolCalls: [{ tool: "traverse", input: {}, durationMs: 5 }],
        };
      }),
    } as unknown as ChatbotService;

    const jsonApi = {
      buildSingle: vi.fn(async (_model: any, record: any) => ({
        data: { type: "assistants", id: record.id, attributes: record },
      })),
      buildList: vi.fn(async (_model: any, records: any[]) => ({
        data: records.map((r) => ({ type: "assistants", id: r.id, attributes: r })),
      })),
    } as any;

    const clsService = {
      get: (key: string) => (key === "userId" ? "u-1" : key === "companyId" ? "c" : undefined),
      has: () => true,
    } as any;

    service = new AssistantService(jsonApi, repo, clsService, userModules, chatbot);
  });

  it("creates an assistant thread and persists the first user+assistant pair", async () => {
    const { assistant, toolCalls } = await service.createWithFirstMessage({
      companyId: "c",
      userId: "u-1",
      roles: ["role-1"],
      firstMessage: "Who is the top account?",
    });
    expect(assistant.id).toBeDefined();
    expect(assistant.messages).toHaveLength(2);
    expect(assistant.messages[0].role).toBe("user");
    expect(assistant.messages[1].role).toBe("assistant");
    expect(assistant.messages[1].references?.[0]).toMatchObject({ type: "accounts", id: "acc-1" });
    expect(assistant.title).toBe("Who is the top account?");
    expect(toolCalls).toEqual([{ tool: "search_entities", input: {}, durationMs: 10 }]);
  });

  it("append re-uses prior references as a reference-memory hint to the agent", async () => {
    const [firstAssistantId] = Array.from(storage.keys());
    const result = await service.appendMessage({
      assistantId: firstAssistantId,
      companyId: "c",
      userId: "u-1",
      roles: ["role-1"],
      newMessage: "And its latest order?",
    });

    // The 2nd chatbot.run call must have received a system message referencing acc-1.
    const secondCall = chatbotRunParams[1];
    const sys = secondCall.messages.find((m) => m.role === "system");
    expect(sys).toBeDefined();
    expect(sys!.content).toContain("accounts/acc-1");
    expect(sys!.content).toContain("primary match");

    // The assistant thread should now hold 4 messages (u1, a1, u2, a2).
    expect(result.assistant.messages).toHaveLength(4);
    expect(result.toolCalls).toEqual([{ tool: "traverse", input: {}, durationMs: 5 }]);
    expect(result.userMessage.content).toBe("And its latest order?");
    expect(result.assistantMessage.content).toContain("ord-1");
  });

  it("inherited find() returns the user's assistant threads via JsonApiService.buildList", async () => {
    const response = await service.find({ query: {} });
    expect(response.data).toBeDefined();
    expect(Array.isArray((response as any).data)).toBe(true);
    expect((response as any).data.length).toBe(1);
  });

  it("inherited findById() returns the assistant thread as a JSON:API document", async () => {
    const [id] = Array.from(storage.keys());
    const response = await service.findById({ id });
    expect((response as any).data).toMatchObject({ type: "assistants", id });
  });

  it("inherited patch() renames via patchFromDTO envelope", async () => {
    const [id] = Array.from(storage.keys());
    await service.patchFromDTO({
      data: { id, type: "assistants", attributes: { title: "Top account review" } },
    });
    const stored = storage.get(id);
    expect(stored.title).toBe("Top account review");
  });

  it("inherited delete() removes the assistant thread", async () => {
    const [id] = Array.from(storage.keys());
    await service.delete({ id });
    expect(storage.has(id)).toBe(false);
  });
});
