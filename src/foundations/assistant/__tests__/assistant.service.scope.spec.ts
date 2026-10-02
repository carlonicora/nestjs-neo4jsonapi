import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { modelRegistry } from "../../../common/registries/registry";
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

/**
 * A rich composer submits its document as a JSON string in the ordinary
 * message attribute — there is no separate blocks parameter on the service.
 */
const messageWithOneMention = JSON.stringify(blocksWithOneMention);

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
  const buildSut = (
    options: {
      dataLimitsProvider?: { forBoundContent: ReturnType<typeof vi.fn> };
      bindGuard?: { canBind: ReturnType<typeof vi.fn> };
      assistantConfig?: { inlineEntityLinks?: boolean };
    } = {},
  ) => {
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
    const operatorResult = {
      kind: "completed",
      answer: "Operator answer",
      questions: [],
      references: [],
      citations: [],
      toolCalls: [],
      tokens: { input: 1, output: 2 },
    };
    const operator = { run: vi.fn(async () => operatorResult), resume: vi.fn(async () => operatorResult) } as any;
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
    const configService = {
      get: vi.fn((key: string) => (key === "assistant" ? options.assistantConfig : undefined)),
    } as any;

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
      undefined,
      options.dataLimitsProvider as any,
      options.bindGuard as any,
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

  it("writes the BOUND_TO edge with the label resolved from the model registry", async () => {
    const { service, repo } = buildSut();
    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "hello",
      boundContent: { type: "campaigns", id: "camp-1" },
    });

    expect(repo.bindContent).toHaveBeenCalledWith(
      expect.objectContaining({ targetLabel: "Campaign", targetId: "camp-1" }),
    );
  });

  it("stores the message as markdown carrying mention links", async () => {
    const { service, assistantMessages } = buildSut();
    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

    await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: messageWithOneMention,
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
      firstMessage: messageWithOneMention,
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
      firstMessage: messageWithOneMention,
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

  it("findByBoundContent walks the BOUND_TO edge with the label resolved from the model registry", async () => {
    const { service, repo } = buildSut();

    await service.findByBoundContent({ boundType: "campaigns", boundId: "camp-1", query: { page: 1 } });

    // findByRelatedEdge, not findByRelated: the `content` relationship is
    // polymorphic, so the target label cannot be derived from the descriptor.
    expect(repo.findByRelatedEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        cypherLabel: "BOUND_TO",
        cypherDirection: "out",
        relatedLabel: "Campaign",
        relatedId: "camp-1",
      }),
    );
  });

  it("findByBoundContent rejects a boundType that is not a registered resource", async () => {
    const { service } = buildSut();

    await expect(service.findByBoundContent({ boundType: "nonesuch", boundId: "x", query: {} })).rejects.toThrow(
      /Unknown resource type "nonesuch"/,
    );
  });

  describe("bound-content data limits, bind guard and inline entity links", () => {
    it("merges the data limits provider result into a bound turn's responder dataLimits", async () => {
      const dataLimitsProvider = {
        forBoundContent: vi.fn(async () => ({ proceedingId: "p1", judgementIds: ["j1"] })),
      };
      const { service, responder } = buildSut({ dataLimitsProvider });
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        firstMessage: "hello",
        boundContent: { type: "campaigns", id: "camp-1" },
      });

      expect(dataLimitsProvider.forBoundContent).toHaveBeenCalledWith({
        type: "campaigns",
        id: "camp-1",
        userId: "u",
        companyId: "c",
      });
      expect(responder.run).toHaveBeenCalledWith(
        expect.objectContaining({
          dataLimits: expect.objectContaining({ proceedingId: "p1", judgementIds: ["j1"] }),
        }),
      );
    });

    it("passes the same dataLimits to operator.run for a bound operator turn", async () => {
      const dataLimitsProvider = {
        forBoundContent: vi.fn(async () => ({ proceedingId: "p1", judgementIds: ["j1"] })),
      };
      const { service, operator } = buildSut({ dataLimitsProvider });
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

      await service.createWithFirstMessageOperator({
        companyId: "c",
        userId: "u",
        firstMessage: "hello",
        boundContent: { type: "campaigns", id: "camp-1" },
      });

      expect(operator.run).toHaveBeenCalledWith(
        expect.objectContaining({
          dataLimits: expect.objectContaining({ proceedingId: "p1", judgementIds: ["j1"] }),
        }),
      );
    });

    it("does not call the provider for an unbound turn", async () => {
      const dataLimitsProvider = {
        forBoundContent: vi.fn(async () => ({ proceedingId: "p1", judgementIds: ["j1"] })),
      };
      const { service, responder } = buildSut({ dataLimitsProvider });
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

      await service.createWithFirstMessage({ companyId: "c", userId: "u", firstMessage: "hello" });

      expect(dataLimitsProvider.forBoundContent).not.toHaveBeenCalled();
      const dataLimits = responder.run.mock.calls[0][0].dataLimits;
      expect(dataLimits).not.toHaveProperty("proceedingId");
      expect(dataLimits).not.toHaveProperty("judgementIds");
    });

    it("attachBoundContent refuses when the bind guard says no", async () => {
      const bindGuard = { canBind: vi.fn(async () => false) };
      const { service, repo } = buildSut({ bindGuard });
      const create = vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

      const error: any = await service
        .createWithFirstMessage({
          companyId: "c",
          userId: "u",
          firstMessage: "hello",
          boundContent: { type: "campaigns", id: "camp-1" },
        })
        .then(
          () => undefined,
          (err) => err,
        );

      expect(error).toBeDefined();
      expect(error.getStatus()).toBe(403);
      expect(bindGuard.canBind).toHaveBeenCalledWith({ type: "campaigns", id: "camp-1", userId: "u", companyId: "c" });
      expect(repo.bindContent).not.toHaveBeenCalled();
      // A refused bind must not leave an unbound thread behind.
      expect(create).not.toHaveBeenCalled();
    });

    it("a refused bind creates no operator thread either", async () => {
      const bindGuard = { canBind: vi.fn(async () => false) };
      const { service, repo } = buildSut({ bindGuard });
      const create = vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

      const error: any = await service
        .createWithFirstMessageOperator({
          companyId: "c",
          userId: "u",
          firstMessage: "hello",
          boundContent: { type: "campaigns", id: "camp-1" },
        })
        .then(
          () => undefined,
          (err) => err,
        );

      expect(error?.getStatus()).toBe(403);
      expect(create).not.toHaveBeenCalled();
      expect(repo.bindContent).not.toHaveBeenCalled();
    });

    it("passes inlineEntityLinks from config to responder.run and operator.run", async () => {
      const { service, responder, operator } = buildSut({ assistantConfig: { inlineEntityLinks: true } });
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);

      await service.createWithFirstMessage({ companyId: "c", userId: "u", firstMessage: "hello" });
      await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: "hello" });

      expect(responder.run).toHaveBeenCalledWith(expect.objectContaining({ inlineEntityLinks: true }));
      expect(operator.run).toHaveBeenCalledWith(expect.objectContaining({ inlineEntityLinks: true }));
    });
  });
});
