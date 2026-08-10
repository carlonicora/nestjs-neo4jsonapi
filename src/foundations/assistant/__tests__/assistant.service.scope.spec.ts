import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { AssistantService } from "../services/assistant.service";

const DEFAULT_TRACE = {
  planner: {
    reasoning: "",
    branchPlan: { runGraph: true, runContextualiser: false, runDrift: false },
    tokens: { input: 0, output: 0 },
  },
  answer: { branchesUsed: ["graph"], tokens: { input: 1, output: 2 } },
  totalTokens: { input: 1, output: 2 },
};

/** One paragraph carrying a single mention chip, as BlockNote serialises it. */
const blocksWithOneMention = [
  {
    type: "paragraph",
    content: [
      { type: "text", text: "tell me about ", styles: {} },
      { type: "mention", props: { id: "npc-1", entityType: "npcs", alias: "One" } },
    ],
  },
];

function makePersistedAssistant() {
  return {
    id: "asst-1",
    type: "assistants",
    title: "Hello there",
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makePersistedMessage(overrides: Partial<any> = {}) {
  return {
    id: "m-1",
    type: "assistant-messages",
    role: "user",
    content: "hi",
    position: 0,
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("AssistantService — campaign binding, mentions and pinned focus", () => {
  const buildSut = () => {
    const responderResponse: any = {
      type: AgentMessageType.Assistant,
      graphContext: { entities: [], toolCalls: [], tokens: { input: 1, output: 2 }, status: "success" },
      answer: { title: "T", analysis: "A", answer: "The answer", questions: [], hasAnswer: true },
      sources: [],
      references: [],
      ontologies: [],
      trace: DEFAULT_TRACE,
      tokens: { input: 1, output: 2 },
    };
    const responder = { run: vi.fn(async () => responderResponse) } as any;
    const operator = { run: vi.fn(), resume: vi.fn() } as any;
    const userModules = { findModuleIdsForUser: vi.fn(async () => ["m-1"]) } as any;

    const repo = {
      create: vi.fn(async () => undefined),
      find: vi.fn(async () => [makePersistedAssistant()]),
      findById: vi.fn(async () => makePersistedAssistant()),
    } as any;

    const assistantMessages = { createFromDTO: vi.fn(async () => ({ data: {} })) } as any;

    const assistantMessageRepo = {
      linkReferences: vi.fn(async () => undefined),
      linkCitations: vi.fn(async () => undefined),
      setTrace: vi.fn(async () => undefined),
      getNextPosition: vi.fn(async () => 0),
      findByRelated: vi.fn(async () => []),
      findById: vi.fn(async ({ id }: any) => makePersistedMessage({ id })),
      findReferencedTypeIdPairs: vi.fn(async () => []),
    } as any;

    const jsonApi = {
      buildSingle: vi.fn(async (_model: any, record: any) => ({ data: { type: record.type, id: record.id } })),
      buildList: vi.fn(async (_model: any, records: any[]) => ({
        data: records.map((r) => ({ type: "assistant-messages", id: r.id })),
      })),
    } as any;

    const clsService = {
      get: (key: string) => (key === "userId" ? "u" : key === "companyId" ? "c" : undefined),
      has: () => true,
      set: vi.fn(),
    } as any;

    // "campaigns" is the compiled scope root (empty hop path); everything else
    // sits one hop below it.
    const graphCatalog = {
      getEntityDetail: vi.fn((type: string) => ({
        type,
        moduleId: "m-1",
        description: "",
        fields: [],
        relationships: [],
        textSearchFields: ["name"],
        nodeName: type,
        labelName: type,
        scope:
          type === "campaigns"
            ? { rootType: "campaigns", rootLabel: "Campaign", path: [] }
            : {
                rootType: "campaigns",
                rootLabel: "Campaign",
                path: [
                  {
                    key: "campaign",
                    cypherLabel: "PART_OF",
                    cypherDirection: "out",
                    targetLabel: "Campaign",
                    targetType: "campaigns",
                  },
                ],
              },
      })),
    } as any;

    const entityServices = {
      get: vi.fn(() => ({ findRecordById: vi.fn(async ({ id }: any) => ({ id, name: `${id}-name` })) })),
    } as any;

    const assistantActions = { createPendingAction: vi.fn() } as any;
    const assistantActionRepo = { findById: vi.fn(), resolveStatus: vi.fn() } as any;
    const webSocketService = { sendMessageToUser: vi.fn(async () => undefined) } as any;
    const configService = { get: vi.fn(() => undefined) } as any;

    const mentions = {
      extract: vi.fn(() => [{ type: "npcs", id: "npc-1", alias: "One" }]),
      validate: vi.fn(async ({ mentions: found }: any) => found),
    } as any;

    const blockNote = {
      convertToMarkdown: vi.fn(({ preserveMentions }: any) =>
        preserveMentions ? "tell me about [One](mention://npcs/npc-1)" : "tell me about One",
      ),
    } as any;

    const scopeGuard = {
      filter: vi.fn(async ({ records }: any) => records),
      isInScope: vi.fn(async () => true),
      buildMatchClause: vi.fn(() => null),
    } as any;

    const service = new AssistantService(
      jsonApi,
      repo,
      clsService,
      userModules,
      responder,
      assistantMessages,
      assistantMessageRepo,
      graphCatalog,
      entityServices,
      operator,
      assistantActions,
      assistantActionRepo,
      webSocketService,
      configService,
      mentions,
      blockNote,
      scopeGuard,
    );

    return {
      service,
      responder,
      repo,
      assistantMessages,
      assistantMessageRepo,
      mentions,
      blockNote,
      scopeGuard,
      graphCatalog,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the BOUND_TO edge from the post relationships block", async () => {
    const { service } = buildSut();
    const createFromDTO = vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "hello",
      boundContent: { type: "campaigns", id: "camp-1" },
    });

    expect(createFromDTO).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          relationships: expect.objectContaining({
            content: { data: { type: "campaigns", id: "camp-1" } },
          }),
        }),
      }),
    );
  });

  it("stores the message as markdown carrying mention links", async () => {
    const { service, assistantMessages } = buildSut();
    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "ignored",
      contentBlocks: blocksWithOneMention,
      boundContent: { type: "campaigns", id: "camp-1" },
    });

    const stored = assistantMessages.createFromDTO.mock.calls[0][0].data.attributes.content;
    expect(stored).toContain("[One](mention://npcs/npc-1)");
  });

  it("links validated mentions as REFERENCES on the USER message and pins them as focus", async () => {
    const { service, assistantMessageRepo, responder } = buildSut();
    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "ignored",
      contentBlocks: blocksWithOneMention,
      boundContent: { type: "campaigns", id: "camp-1" },
    });

    expect(assistantMessageRepo.linkReferences).toHaveBeenCalledWith(
      expect.objectContaining({ references: [expect.objectContaining({ type: "npcs", id: "npc-1" })] }),
    );
    expect(responder.run).toHaveBeenCalledWith(expect.objectContaining({ scopeId: "camp-1", scopeType: "campaigns" }));
  });

  it("hydrates a pinned mention as a focus record on the very first turn", async () => {
    const { service, responder } = buildSut();
    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "ignored",
      contentBlocks: blocksWithOneMention,
      boundContent: { type: "campaigns", id: "camp-1" },
    });

    const sys = responder.run.mock.calls[0][0].messages.find((m: any) => m.type === AgentMessageType.System);
    expect(sys).toBeDefined();
    expect(sys.content).toContain('"id": "npc-1"');
    expect(sys.content).toContain("The user named some of these entities explicitly");
  });

  it("drops out-of-scope hydration records through ScopeGuard.filter", async () => {
    const { service, responder, scopeGuard, assistantMessageRepo } = buildSut();
    assistantMessageRepo.findByRelated.mockResolvedValue([
      makePersistedMessage({ id: "a0", role: "assistant", content: "answer", position: 1 }),
    ]);
    assistantMessageRepo.findReferencedTypeIdPairs.mockResolvedValue([
      { messageId: "a0", type: "npcs", id: "npc-leak" },
    ]);
    scopeGuard.filter.mockResolvedValue([]);
    (service as any).repository.findById = vi.fn(async () => ({
      ...makePersistedAssistant(),
      content: { type: "campaigns", id: "camp-1" },
    }));

    await service.appendMessage({
      assistantId: "asst-1",
      companyId: "c",
      userId: "u",
      newMessage: "and now?",
    });

    expect(scopeGuard.filter).toHaveBeenCalledWith(
      expect.objectContaining({ type: "npcs", ctx: expect.objectContaining({ scopeId: "camp-1" }) }),
    );
    const sys = responder.run.mock.calls[0][0].messages.find((m: any) => m.type === AgentMessageType.System);
    expect(sys).toBeUndefined();
  });

  it("findByBoundContent delegates to the inherited findByRelated over the content relationship", async () => {
    const { service } = buildSut();
    const findByRelated = vi.spyOn(service as any, "findByRelated").mockResolvedValue({ data: [] });

    await service.findByBoundContent({ boundId: "camp-1", query: { page: 1 } });

    expect(findByRelated).toHaveBeenCalledWith({
      relationship: "content",
      id: "camp-1",
      query: { page: 1 },
    });
  });
});
