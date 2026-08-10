import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { modelRegistry } from "../../../common/registries/registry";
import type { AssistantSeedContextProvider } from "../../../common/interfaces/seed.context.interface";
import { AssistantService } from "../services/assistant.service";

// The bound-content path resolves the target's Neo4j label from the global
// model registry, which no host app has populated inside a unit test.
modelRegistry.register({ nodeName: "campaign", labelName: "Campaign", type: "campaigns" } as any);

const DEFAULT_TRACE = {
  planner: {
    reasoning: "",
    branchPlan: { runGraph: true, runContextualiser: false, runDrift: false },
    tokens: { input: 0, output: 0 },
  },
  answer: { branchesUsed: ["graph"], tokens: { input: 1, output: 2 } },
  totalTokens: { input: 1, output: 2 },
};

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

describe("AssistantService — seed contexts", () => {
  const buildSut = (seedProviders?: AssistantSeedContextProvider[]) => {
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
      bindContent: vi.fn(async () => undefined),
      findByRelatedEdge: vi.fn(async () => []),
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
      extract: vi.fn(() => []),
      validate: vi.fn(async ({ mentions: found }: any) => found),
    } as any;

    const blockNote = {
      convertToMarkdown: vi.fn(({ preserveMentions }: any) => (preserveMentions ? "hello" : "hello")),
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
      seedProviders,
    );

    return {
      service,
      responder,
      operator,
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

  const seed = {
    title: "CAMPAIGN TIMELINE — KEY EVENTS",
    content: "- the heist",
    references: [{ type: "events", id: "evt-1", reason: "key event on the campaign timeline" }],
  };

  it("collects seed contexts and passes them to the responder run", async () => {
    const provider = { provide: vi.fn(async () => seed) };
    const { service, responder } = buildSut([provider]);
    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "hello",
      boundContent: { type: "campaigns", id: "camp-1" },
    });

    expect(provider.provide).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: "camp-1", scopeType: "campaigns", question: expect.any(String) }),
    );
    expect(responder.run).toHaveBeenCalledWith(expect.objectContaining({ seedContexts: [seed] }));
  });

  it("skips a throwing provider and still runs the turn unseeded", async () => {
    const provider = {
      provide: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { service, responder } = buildSut([provider]);
    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "hello",
      boundContent: { type: "campaigns", id: "camp-1" },
    });

    expect(responder.run).toHaveBeenCalledWith(expect.objectContaining({ seedContexts: [] }));
  });

  it("does not call providers on help-mode turns", async () => {
    const provider = { provide: vi.fn(async () => seed) };
    const { service } = buildSut([provider]);
    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "hello",
      howToMode: true,
    });

    expect(provider.provide).not.toHaveBeenCalled();
  });
});
