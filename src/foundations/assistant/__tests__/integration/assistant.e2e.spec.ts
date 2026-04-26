import { beforeAll, describe, expect, it, vi } from "vitest";
import { AssistantService } from "../../services/assistant.service";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";

const EMPTY_CONTEXT_RESPONSE = {
  type: AgentMessageType.Assistant,
  rationalPlan: "",
  annotations: "",
  notebook: [],
  processedElements: { chunks: [], keyConcepts: [], atomicFacts: [] },
  sources: [],
  requests: [],
  tokens: { input: 0, output: 0 },
};

type ResponderRunParams = any;

/**
 * Scripted-LLM integration: exercises the full AssistantService lifecycle
 * (create → append) against in-memory repo + in-memory responder stubs.
 * Asserts the key behavioural contract: a 2nd turn gets a reference-memory
 * system message derived from the 1st turn's references.
 *
 * Standard CRUD (find / findById / patch / delete) is provided by
 * AbstractService and exercised through the framework's test suite — this
 * integration focuses on the non-standard agent-turn flow.
 */
describe("Assistant lifecycle (integration, scripted agent)", () => {
  let service: AssistantService;
  let assistantStorage: Map<string, any>;
  let messageStorage: Map<string, any>;
  let responderRunParams: ResponderRunParams[];
  let assistantMessageRepo: any;

  beforeAll(() => {
    assistantStorage = new Map();
    messageStorage = new Map();
    responderRunParams = [];

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
      linkCitations: vi.fn(async () => {}),
      setTrace: vi.fn(async () => {}),
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

    const userModules = { findModuleIdsForUser: vi.fn(async () => ["11111111-1111-1111-1111-111111111111"]) } as any;

    // Scripted responder — turn 1 returns a reference; turn 2 asserts hydration was passed.
    let turn = 0;
    const responder = {
      run: vi.fn(async (params: ResponderRunParams) => {
        responderRunParams.push({
          ...params,
          messages: params.messages.map((m: any) => ({ ...m })),
        });
        turn += 1;
        if (turn === 1) {
          return {
            type: AgentMessageType.Assistant,
            context: EMPTY_CONTEXT_RESPONSE,
            graphContext: {
              entities: [{ type: "accounts", id: "acc-1", reason: "primary match", foundAtHop: 0 }],
              toolCalls: [{ tool: "search_entities", input: {}, durationMs: 10 }],
              tokens: { input: 100, output: 50 },
              status: "success",
            },
            answer: {
              title: "Top account",
              analysis: "",
              answer: "Acme is the top account.",
              questions: [],
              hasAnswer: true,
            },
            sources: [{ chunkId: "chunk-1", relevance: 80, reason: "" }],
            references: [{ type: "accounts", id: "acc-1", relevance: 95, reason: "primary match" }],
            ontologies: [],
            trace: {
              planner: {
                reasoning: "",
                branchPlan: { runGraph: true, runContextualiser: false, runDrift: false },
                tokens: { input: 5, output: 5 },
              },
              answer: { branchesUsed: ["graph"], tokens: { input: 100, output: 50 } },
              totalTokens: { input: 105, output: 55 },
            },
            tokens: { input: 105, output: 55 },
          };
        }
        return {
          type: AgentMessageType.Assistant,
          context: EMPTY_CONTEXT_RESPONSE,
          graphContext: {
            entities: [{ type: "orders", id: "ord-1", reason: "latest order", foundAtHop: 0 }],
            toolCalls: [{ tool: "traverse", input: {}, durationMs: 5 }],
            tokens: { input: 120, output: 60 },
            status: "success",
          },
          answer: {
            title: "Latest order",
            analysis: "",
            answer: "Its latest order is #ord-1 for 1000.",
            questions: [],
            hasAnswer: true,
          },
          sources: [],
          references: [{ type: "orders", id: "ord-1", relevance: 92, reason: "latest order" }],
          ontologies: [],
          trace: {
            planner: {
              reasoning: "",
              branchPlan: { runGraph: true, runContextualiser: false, runDrift: false },
              tokens: { input: 5, output: 5 },
            },
            answer: { branchesUsed: ["graph"], tokens: { input: 120, output: 60 } },
            totalTokens: { input: 125, output: 65 },
          },
          tokens: { input: 125, output: 65 },
        };
      }),
    };

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
        moduleId: "11111111-1111-1111-1111-111111111111",
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
      responder as any,
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

  it("persists per-turn citations and the unified trace via the new repo methods", async () => {
    expect(assistantMessageRepo.linkCitations).toHaveBeenCalled();
    const lastCitationCall = (assistantMessageRepo.linkCitations as any).mock.calls.at(-1)![0];
    expect(lastCitationCall.citations).toEqual([{ chunkId: "chunk-1", relevance: 80, reason: "" }]);
    expect(lastCitationCall.messageId).toBeDefined();

    expect(assistantMessageRepo.setTrace).toHaveBeenCalled();
    const lastTraceCall = (assistantMessageRepo.setTrace as any).mock.calls.at(-1)![0];
    expect(typeof lastTraceCall.trace).toBe("string");
    const parsed = JSON.parse(lastTraceCall.trace);
    expect(parsed.totalTokens).toEqual({ input: 105, output: 55 });
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
      newMessage: "And its latest order?",
    });

    // The 2nd responder.run call must have received a system message referencing acc-1.
    const secondCall = responderRunParams[1];
    const sys = secondCall.messages.find((m: any) => m.type === AgentMessageType.System);
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

  it("turn 2 with empty sources still calls setTrace but skips linkCitations", async () => {
    // Turn 2's responder mock returned sources: [] — linkCitations should NOT have
    // been called for that assistant message id, but setTrace was.
    const [firstAssistantId] = Array.from(assistantStorage.keys());
    const turn2AssistantMsg = Array.from(messageStorage.values())
      .filter((m: any) => m.assistantId === firstAssistantId && m.role === "assistant")
      .sort((a: any, b: any) => a.position - b.position)
      .at(-1) as any;
    expect(turn2AssistantMsg).toBeDefined();

    const citationCallsForTurn2 = (assistantMessageRepo.linkCitations as any).mock.calls.filter(
      ([arg]: any[]) => arg.messageId === turn2AssistantMsg.id,
    );
    expect(citationCallsForTurn2).toHaveLength(0);

    const traceCallsForTurn2 = (assistantMessageRepo.setTrace as any).mock.calls.filter(
      ([arg]: any[]) => arg.messageId === turn2AssistantMsg.id,
    );
    expect(traceCallsForTurn2).toHaveLength(1);
    const parsed = JSON.parse(traceCallsForTurn2[0][0].trace);
    expect(parsed.totalTokens).toEqual({ input: 125, output: 65 });
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
  let nextResponderResponse: any;

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
      linkCitations: vi.fn(async () => {}),
      setTrace: vi.fn(async () => {}),
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

    const userModules = { findModuleIdsForUser: vi.fn(async () => ["11111111-1111-1111-1111-111111111111"]) } as any;

    const responder = { run: vi.fn(async () => nextResponderResponse) };

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
        moduleId: "11111111-1111-1111-1111-111111111111",
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
      responder as any,
      assistantMessages,
      assistantMessageRepo,
      graphCatalog,
      entityServices,
    );
  });

  it("does NOT set a `references` attribute on the persisted assistant message", async () => {
    nextResponderResponse = {
      type: AgentMessageType.Assistant,
      context: EMPTY_CONTEXT_RESPONSE,
      graphContext: {
        entities: [],
        toolCalls: [],
        tokens: { input: 0, output: 0 },
        status: "success",
      },
      answer: { title: "", analysis: "", answer: "Acme is the customer.", questions: [], hasAnswer: true },
      sources: [],
      references: [{ type: "accounts", id: "acc-1", relevance: 90, reason: "resolved" }],
      ontologies: [],
      trace: {
        planner: {
          reasoning: "",
          branchPlan: { runGraph: true, runContextualiser: false, runDrift: false },
          tokens: { input: 0, output: 0 },
        },
        answer: { branchesUsed: ["graph"], tokens: { input: 0, output: 0 } },
        totalTokens: { input: 0, output: 0 },
      },
      tokens: { input: 0, output: 0 },
    };
    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u-1",
      firstMessage: "Who's the customer?",
    });
    const assistantCreateCall = (assistantMessages.createFromDTO as any).mock.calls.find(
      ([dto]: any[]) => dto.data.attributes.role === "assistant",
    );
    expect(assistantCreateCall).toBeDefined();
    expect(assistantCreateCall[0].data.attributes.references).toBeUndefined();
  });

  it("still calls linkReferences for each reference returned by the responder", async () => {
    nextResponderResponse = {
      type: AgentMessageType.Assistant,
      context: EMPTY_CONTEXT_RESPONSE,
      graphContext: {
        entities: [],
        toolCalls: [],
        tokens: { input: 0, output: 0 },
        status: "success",
      },
      answer: { title: "", analysis: "", answer: "…", questions: [], hasAnswer: true },
      sources: [],
      references: [{ type: "accounts", id: "acc-1", relevance: 80, reason: "x" }],
      ontologies: [],
      trace: {
        planner: {
          reasoning: "",
          branchPlan: { runGraph: true, runContextualiser: false, runDrift: false },
          tokens: { input: 0, output: 0 },
        },
        answer: { branchesUsed: ["graph"], tokens: { input: 0, output: 0 } },
        totalTokens: { input: 0, output: 0 },
      },
      tokens: { input: 0, output: 0 },
    };
    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u-1",
      firstMessage: "q",
    });
    expect(assistantMessageRepo.linkReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [expect.objectContaining({ type: "accounts", id: "acc-1" })],
      }),
    );
  });
});
