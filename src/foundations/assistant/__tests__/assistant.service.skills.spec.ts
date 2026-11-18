import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantService } from "../services/assistant.service";
import { AssistantMentionExtractor } from "../services/assistant-mention.extractor";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { ScopeGuard } from "../../../agents/graph/services/scope.guard";
import { modelRegistry } from "../../../common/registries/registry";
import type { AssistantSkillProvider } from "../../../common/interfaces/assistant.skill.interface";

// `attachBoundContent` resolves the BOUND_TO target label from the model
// registry, which no host app has populated inside a unit test.
modelRegistry.register({ nodeName: "campaign", labelName: "Campaign", type: "campaigns" } as any);

const ACTIVE = [
  { name: "email", description: "How we write emails" },
  { name: "humanizer", description: "Plain words" },
];

const COMPLETED_RESULT = {
  kind: "completed" as const,
  answer: "The operator answer",
  questions: [],
  references: [],
  citations: [],
  toolCalls: [],
  tokens: { input: 3, output: 4 },
  skillsUsed: ["email", "humanizer"],
};

function makePersistedAssistant() {
  return {
    id: "asst-1",
    type: "assistants",
    title: "t",
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
    content: "the stored [Marta](mention://npcs/n-1) message",
    position: 0,
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePersistedAction() {
  return {
    id: "act-1",
    type: "assistant-actions",
    status: "pending",
    toolName: "operator_test_action",
    toolArgs: JSON.stringify({}),
    summary: "s",
    threadId: "asst-1:um-1",
    userModuleIds: JSON.stringify(["11111111-1111-1111-1111-111111111111"]),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("AssistantService — skills", () => {
  const buildSut = (
    opts: { provider?: AssistantSkillProvider; runResult?: any; startMessageThrows?: boolean } = {},
  ) => {
    const operator = {
      run: vi.fn(async () => opts.runResult ?? COMPLETED_RESULT),
      resume: vi.fn(async () => opts.runResult ?? COMPLETED_RESULT),
    } as any;
    const userModules = { findModuleIdsForUser: vi.fn(async () => ["11111111-1111-1111-1111-111111111111"]) } as any;
    const createdMessages: any[] = [];
    const repo = {
      create: vi.fn(async () => undefined),
      find: vi.fn(async () => [makePersistedAssistant()]),
      findById: vi.fn(async () => makePersistedAssistant()),
      bindContent: vi.fn(async () => undefined),
    } as any;
    const assistantMessages = {
      createFromDTO: vi.fn(async (dto: any) => {
        createdMessages.push(dto);
        return { data: {} };
      }),
    } as any;
    const assistantMessageRepo = {
      linkReferences: vi.fn(async () => undefined),
      linkCitations: vi.fn(async () => undefined),
      setTrace: vi.fn(async () => undefined),
      getNextPosition: vi.fn(async () => 0),
      findByRelated: vi.fn(async () => []),
      findById: vi.fn(async ({ id }: any) => {
        if (opts.startMessageThrows && id === "um-1") throw new Error("read failed");
        return makePersistedMessage({ id });
      }),
      findReferencedTypeIdPairs: vi.fn(async () => []),
    } as any;
    const assistantActions = { createPendingAction: vi.fn() } as any;
    const assistantActionRepo = {
      findById: vi.fn(async () => makePersistedAction()),
      resolveStatus: vi.fn(async () => true),
    } as any;
    const webSocketService = { sendMessageToUser: vi.fn(async () => undefined) } as any;
    const configService = { get: vi.fn(() => undefined) } as any;
    const jsonApi = {
      buildSingle: vi.fn(async (_model: any, record: any) => ({ data: { type: record.type, id: record.id } })),
      buildList: vi.fn(),
    } as any;
    const clsService = {
      get: (key: string) => (key === "userId" ? "u" : key === "companyId" ? "c" : undefined),
      has: () => true,
      set: vi.fn(),
    } as any;
    const graphCatalog = { getEntityDetail: vi.fn() } as any;
    const entityServices = { get: vi.fn() } as any;
    // BlockNote: the markdown keeps mention links and no slash command; the
    // plain text is what the user typed.
    const blockNote = {
      convertToMarkdown: vi.fn(({ preserveMentions }: { preserveMentions?: boolean }) =>
        preserveMentions ? "send an [Marta](mention://npcs/n-1) note" : "send an /email to Marta",
      ),
    } as unknown as BlockNoteService;
    const mentions = {
      extract: vi.fn(() => []),
      validate: vi.fn(async () => []),
    } as unknown as AssistantMentionExtractor;

    const service = new AssistantService(
      jsonApi,
      repo,
      clsService,
      userModules,
      { run: vi.fn() } as any,
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
      undefined as unknown as ScopeGuard, // scopeGuard: unscoped turns never reach it
      undefined, // seedContextProviders
      undefined, // dataLimitsProvider
      undefined, // bindGuard
      undefined, // titleGenerator
      undefined, // userMessageListener
      opts.provider,
    );
    vi.spyOn(service, "createFromDTO").mockResolvedValue(undefined as any);
    return { service, operator, createdMessages };
  };

  const makeProvider = () =>
    ({
      listActive: vi.fn(async () => ACTIVE),
      load: vi.fn(async () => []),
    }) as unknown as AssistantSkillProvider & { listActive: ReturnType<typeof vi.fn> };

  const answerOf = (createdMessages: any[]) => createdMessages.find((m) => m.data.attributes.role === "assistant");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("without a provider: no skills passed, the answer has skillsUsed []", async () => {
    const { service, operator, createdMessages } = buildSut({
      runResult: { ...COMPLETED_RESULT, skillsUsed: undefined },
    });
    await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: "send an /email" });

    const args = operator.run.mock.calls[0][0];
    expect(args).not.toHaveProperty("offeredSkills");
    expect(args).not.toHaveProperty("namedSkillNames");
    expect(answerOf(createdMessages).data.attributes.skillsUsed).toEqual([]);
  });

  it("with a provider: offers the active skills and names the ones in the first message", async () => {
    const provider = makeProvider();
    const { service, operator } = buildSut({ provider });
    await service.createWithFirstMessageOperator({
      companyId: "c",
      userId: "u",
      firstMessage: "send an /email to Marta",
    });

    expect(provider.listActive).toHaveBeenCalled();
    const args = operator.run.mock.calls[0][0];
    expect(args.offeredSkills).toEqual(ACTIVE);
    expect(args.namedSkillNames).toEqual(["email"]);
  });

  it("names skills from the plain text of a BlockNote first message", async () => {
    const provider = makeProvider();
    const { service, operator } = buildSut({ provider });
    const doc = JSON.stringify([{ type: "paragraph", content: [{ type: "text", text: "send an /email to Marta" }] }]);
    await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: doc });

    expect(operator.run.mock.calls[0][0].namedSkillNames).toEqual(["email"]);
  });

  it("names skills in a follow-up message", async () => {
    const provider = makeProvider();
    const { service, operator } = buildSut({ provider });
    await service.appendMessageOperator({
      assistantId: "asst-1",
      companyId: "c",
      userId: "u",
      newMessage: "now /humanizer it",
    });

    const args = operator.run.mock.calls[0][0];
    expect(args.offeredSkills).toEqual(ACTIVE);
    expect(args.namedSkillNames).toEqual(["humanizer"]);
  });

  it.each([{ howToMode: true }, { limitToHowToId: "how-1" }])(
    "offers no skills in a how-to turn (%o)",
    async (mode) => {
      const provider = makeProvider();
      const { service, operator } = buildSut({ provider });
      await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: "/email", ...mode });

      expect(provider.listActive).not.toHaveBeenCalled();
      const args = operator.run.mock.calls[0][0];
      expect(args).not.toHaveProperty("offeredSkills");
      expect(args).not.toHaveProperty("namedSkillNames");
    },
  );

  it("saves the skills the operator used on the answer", async () => {
    const { service, createdMessages } = buildSut({ provider: makeProvider() });
    await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: "hello" });

    expect(answerOf(createdMessages).data.attributes.skillsUsed).toEqual(["email", "humanizer"]);
  });

  it("resolveAction: offers the skills again with the stored question, names nothing", async () => {
    const provider = makeProvider();
    const { service, operator, createdMessages } = buildSut({
      provider,
      runResult: { ...COMPLETED_RESULT, skillsUsed: ["email"] },
    });
    await service.resolveAction({ actionId: "act-1", approved: true });

    expect(provider.listActive).toHaveBeenCalled();
    const args = operator.resume.mock.calls[0][0];
    expect(args.offeredSkills).toEqual(ACTIVE);
    expect(args.question).toBe(makePersistedMessage().content);
    expect(args).not.toHaveProperty("namedSkillNames");
    expect(answerOf(createdMessages).data.attributes.skillsUsed).toEqual(["email"]);
  });

  it("resolveAction: a failed read of the starting message still resumes, with an empty question", async () => {
    const { service, operator } = buildSut({ provider: makeProvider(), startMessageThrows: true });
    await service.resolveAction({ actionId: "act-1", approved: true });

    expect(operator.resume).toHaveBeenCalledTimes(1);
    expect(operator.resume.mock.calls[0][0].question).toBe("");
  });
});
