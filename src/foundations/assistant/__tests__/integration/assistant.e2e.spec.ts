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
  let assistantStorage: Map<string, any>;
  let messageStorage: Map<string, any>;
  let chatbotRunParams: ChatbotRunParams[];
  let assistantMessageRepo: any;

  beforeAll(() => {
    assistantStorage = new Map();
    messageStorage = new Map();
    chatbotRunParams = [];

    const assistantRepo = {
      create: vi.fn(async (params: any) => {
        assistantStorage.set(params.id, {
          id: params.id,
          type: "assistants",
          title: params.title,
          company: { id: "c" },
          createdAt: new Date(),
          updatedAt: new Date(),
          owner: { id: "u-1" },
        });
      }),
      patch: vi.fn(async (params: any) => {
        const existing = assistantStorage.get(params.id);
        if (!existing) throw new Error(`Not found: ${params.id}`);
        assistantStorage.set(params.id, {
          ...existing,
          ...(params.title !== undefined ? { title: params.title } : {}),
          updatedAt: new Date(),
        });
      }),
      delete: vi.fn(async (params: any) => {
        assistantStorage.delete(params.id);
        for (const [id, m] of messageStorage) {
          if (m.assistantId === params.id) messageStorage.delete(id);
        }
      }),
      findById: vi.fn(async (params: any) => {
        const entity = assistantStorage.get(params.id);
        if (!entity) throw new Error(`Not found: ${params.id}`);
        return entity;
      }),
      find: vi.fn(async () => Array.from(assistantStorage.values())),
    } as any;

    assistantMessageRepo = {
      linkReferences: vi.fn(async () => {}),
      getNextPosition: vi.fn(async (params: any) => {
        const existing = Array.from(messageStorage.values()).filter((m: any) => m.assistantId === params.assistantId);
        return existing.length;
      }),
      findByRelated: vi.fn(async (params: any) => {
        const all = Array.from(messageStorage.values()).filter((m: any) => m.assistantId === params.id);
        return all.sort((a: any, b: any) => b.position - a.position);
      }),
      findById: vi.fn(async (params: any) => {
        const m = messageStorage.get(params.id);
        if (!m) throw new Error(`Not found: ${params.id}`);
        return m;
      }),
      findReferencedTypeIdPairs: vi.fn(async () => []),
    } as any;

    const assistantMessages = {
      createFromDTO: vi.fn(async (dto: any) => {
        const msg = {
          id: dto.data.id,
          type: "assistant-messages",
          assistantId: dto.data.relationships?.assistant?.data?.id,
          ...dto.data.attributes,
          company: { id: "c" },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        messageStorage.set(dto.data.id, msg);
        return { data: {} };
      }),
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

    const graphCatalog = {
      getEntityDetail: vi.fn((type: string) => ({
        type,
        module: "crm",
        description: "",
        fields: [],
        relationships: [],
        textSearchFields: ["name"],
        nodeName: type,
        labelName: type,
      })),
    } as any;

    const entityServices = {
      get: vi.fn((_type: string) => ({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: `${id}-name` })),
      })),
    } as any;

    service = new AssistantService(
      jsonApi,
      assistantRepo,
      clsService,
      userModules,
      chatbot,
      assistantMessages,
      assistantMessageRepo,
      graphCatalog,
      entityServices,
    );
  });

  it("creates an assistant thread and persists the first user+assistant pair as child nodes", async () => {
    const { assistant, userMessage, assistantMessage, toolCalls } = await service.createWithFirstMessage({
      companyId: "c",
      userId: "u-1",
      roles: ["role-1"],
      firstMessage: "Who is the top account?",
    });
    expect(assistant.id).toBeDefined();
    expect(userMessage.role).toBe("user");
    expect(assistantMessage.role).toBe("assistant");
    expect(assistant.title).toBe("Who is the top account?");
    expect(toolCalls).toEqual([{ tool: "search_entities", input: {}, durationMs: 10 }]);

    // Two AssistantMessage nodes were written, linked to the Assistant.
    const storedMessages = Array.from(messageStorage.values()).filter((m: any) => m.assistantId === assistant.id);
    expect(storedMessages).toHaveLength(2);
    expect(storedMessages.find((m: any) => m.role === "user")?.position).toBe(0);
    expect(storedMessages.find((m: any) => m.role === "assistant")?.position).toBe(1);
  });

  it("append re-uses prior references as a reference-memory hint to the agent", async () => {
    const [firstAssistantId] = Array.from(assistantStorage.keys());
    const prevAssistantMessage = Array.from(messageStorage.values()).find(
      (m: any) => m.assistantId === firstAssistantId && m.role === "assistant",
    ) as any;
    (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
      { messageId: prevAssistantMessage.id, type: "accounts", id: "acc-1" },
    ]);
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
    expect(sys!.content).toContain('"type": "accounts"');
    expect(sys!.content).toContain('"id": "acc-1"');

    // The thread now holds 4 child messages (u0, a0, u1, a1).
    const storedMessages = Array.from(messageStorage.values()).filter((m: any) => m.assistantId === firstAssistantId);
    expect(storedMessages).toHaveLength(4);
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
    const [id] = Array.from(assistantStorage.keys());
    const response = await service.findById({ id });
    expect((response as any).data).toMatchObject({ type: "assistants", id });
  });

  it("inherited patch() renames via patchFromDTO envelope", async () => {
    const [id] = Array.from(assistantStorage.keys());
    await service.patchFromDTO({
      data: { id, type: "assistants", attributes: { title: "Top account review" } },
    });
    const stored = assistantStorage.get(id);
    expect(stored.title).toBe("Top account review");
  });

  it("inherited delete() removes the assistant thread (and cascades messages via the repo stub)", async () => {
    const [id] = Array.from(assistantStorage.keys());
    await service.delete({ id });
    expect(assistantStorage.has(id)).toBe(false);
    const remaining = Array.from(messageStorage.values()).filter((m: any) => m.assistantId === id);
    expect(remaining).toHaveLength(0);
  });
});

describe("Assistant lifecycle (integration, references shape)", () => {
  let service: AssistantService;
  let assistantMessages: any;
  let assistantMessageRepo: any;
  let nextChatbotResponse: any;

  beforeAll(() => {
    const assistantStorage = new Map();
    const messageStorage = new Map();

    const assistantRepo = {
      create: vi.fn(async (params: any) => {
        assistantStorage.set(params.id, {
          id: params.id,
          type: "assistants",
          title: params.title,
          company: { id: "c" },
          createdAt: new Date(),
          updatedAt: new Date(),
          owner: { id: "u-1" },
        });
      }),
      patch: vi.fn(async (params: any) => {
        const existing = assistantStorage.get(params.id);
        if (!existing) throw new Error(`Not found: ${params.id}`);
        assistantStorage.set(params.id, { ...existing, updatedAt: new Date() });
      }),
      delete: vi.fn(async (params: any) => {
        assistantStorage.delete(params.id);
      }),
      findById: vi.fn(async (params: any) => {
        const entity = assistantStorage.get(params.id);
        if (!entity) throw new Error(`Not found: ${params.id}`);
        return entity;
      }),
      find: vi.fn(async () => Array.from(assistantStorage.values())),
    } as any;

    assistantMessageRepo = {
      linkReferences: vi.fn(async () => {}),
      getNextPosition: vi.fn(async (params: any) => {
        const existing = Array.from(messageStorage.values()).filter((m: any) => m.assistantId === params.assistantId);
        return existing.length;
      }),
      findByRelated: vi.fn(async (params: any) => {
        const all = Array.from(messageStorage.values()).filter((m: any) => m.assistantId === params.id);
        return all.sort((a: any, b: any) => b.position - a.position);
      }),
      findById: vi.fn(async (params: any) => {
        const m = messageStorage.get(params.id);
        if (!m) throw new Error(`Not found: ${params.id}`);
        return m;
      }),
    } as any;

    assistantMessages = {
      createFromDTO: vi.fn(async (dto: any) => {
        const msg = {
          id: dto.data.id,
          type: "assistant-messages",
          assistantId: dto.data.relationships?.assistant?.data?.id,
          ...dto.data.attributes,
          company: { id: "c" },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        messageStorage.set(dto.data.id, msg);
        return { data: {} };
      }),
    } as any;

    const userModules = { findModulesForRoles: vi.fn(async () => ["crm"]) } as any;

    const chatbot = { run: vi.fn(async () => nextChatbotResponse) } as unknown as ChatbotService;

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

    const graphCatalog = {
      getEntityDetail: vi.fn((type: string) => ({
        type,
        module: "crm",
        description: "",
        fields: [],
        relationships: [],
        textSearchFields: ["name"],
        nodeName: type,
        labelName: type,
      })),
    } as any;

    const entityServices = {
      get: vi.fn((_type: string) => ({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: `${id}-name` })),
      })),
    } as any;

    service = new AssistantService(
      jsonApi,
      assistantRepo,
      clsService,
      userModules,
      chatbot,
      assistantMessages,
      assistantMessageRepo,
      graphCatalog,
      entityServices,
    );
  });

  it("does NOT set a `references` attribute on the persisted assistant message", async () => {
    nextChatbotResponse = {
      type: "assistant",
      answer: "Acme is the customer.",
      references: [{ type: "accounts", id: "acc-1", reason: "resolved" }],
      needsClarification: false,
      suggestedQuestions: [],
      tokens: { input: 0, output: 0 },
      toolCalls: [],
    };
    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u-1",
      roles: [],
      firstMessage: "Who's the customer?",
    });
    const assistantCreateCall = (assistantMessages.createFromDTO as any).mock.calls.find(
      ([dto]: any[]) => dto.data.attributes.role === "assistant",
    );
    expect(assistantCreateCall).toBeDefined();
    expect(assistantCreateCall[0].data.attributes.references).toBeUndefined();
  });

  it("still calls linkReferences for each reference returned by the chatbot", async () => {
    nextChatbotResponse = {
      type: "assistant",
      answer: "…",
      references: [{ type: "accounts", id: "acc-1", reason: "x" }],
      needsClarification: false,
      suggestedQuestions: [],
      tokens: { input: 0, output: 0 },
      toolCalls: [],
    };
    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u-1",
      roles: [],
      firstMessage: "q",
    });
    expect(assistantMessageRepo.linkReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [expect.objectContaining({ type: "accounts", id: "acc-1" })],
      }),
    );
  });
});
