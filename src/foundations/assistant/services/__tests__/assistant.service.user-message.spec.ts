import { beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import { ClsService } from "nestjs-cls";
import { ConfigService } from "@nestjs/config";
import { AssistantService } from "../assistant.service";
import { AssistantMentionExtractor } from "../assistant-mention.extractor";
import { AssistantRepository } from "../../repositories/assistant.repository";
import { AssistantMessageService } from "../../../assistant-message/services/assistant-message.service";
import { AssistantMessageRepository } from "../../../assistant-message/repositories/assistant-message.repository";
import { UserModulesRepository } from "../../../../agents/graph/repositories/user-modules.repository";
import { ResponderService } from "../../../../agents/responder/services/responder.service";
import { GraphCatalogService } from "../../../../agents/graph/services/graph.catalog.service";
import { ScopeGuard } from "../../../../agents/graph/services/scope.guard";
import { OperatorService } from "../../../../agents/operator/services/operator.service";
import { EntityServiceRegistry } from "../../../../common/registries/entity.service.registry";
import { AssistantUserMessageListener } from "../../../../common/interfaces/assistant.user-message.interface";
import { BaseConfigInterface } from "../../../../config/interfaces/base.config.interface";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { WebSocketService } from "../../../../core/websocket/services/websocket.service";
import { AssistantActionService } from "../../../assistant-action/services/assistant-action.service";
import { AssistantActionRepository } from "../../../assistant-action/repositories/assistant-action.repository";

const TURN = {
  id: "am-1",
  role: "assistant" as const,
  content: "The answer",
  createdAt: new Date().toISOString(),
  references: [],
  sources: [],
  suggestedQuestions: [],
  tokens: { input: 1, output: 2 },
  toolCalls: [],
  trace: {},
};

const BOUND = { type: "campaigns", id: "camp-1" };

/** The private steps the hook sits between, stubbed so only the hook is under test. */
type AssistantServiceInternals = {
  validateBoundContent: () => Promise<string | undefined>;
  loadRecentMessages: () => Promise<unknown[]>;
  runAgentTurn: () => Promise<unknown>;
  runOperatorTurn: () => Promise<unknown>;
  persistOperatorOutcome: () => Promise<unknown>;
};

describe("AssistantService — user message listener", () => {
  const order: string[] = [];
  const messageAssistantIds: string[] = [];

  let repo: Mocked<Pick<AssistantRepository, "findById" | "bindContent">>;
  let assistantMessages: Mocked<Pick<AssistantMessageService, "createFromDTO">>;
  let assistantMessageRepo: Mocked<
    Pick<AssistantMessageRepository, "findById" | "getNextPosition" | "linkReferences" | "linkCitations" | "setTrace">
  >;
  let userModules: Mocked<Pick<UserModulesRepository, "findModuleIdsForUser">>;
  let jsonApi: Mocked<Pick<JsonApiService, "buildSingle">>;
  let webSocketService: Mocked<Pick<WebSocketService, "sendMessageToUser">>;
  let clsService: Mocked<Pick<ClsService, "get" | "has" | "set">>;
  let configService: Mocked<Pick<ConfigService<BaseConfigInterface>, "get">>;

  const buildSut = (listener?: Mocked<AssistantUserMessageListener>) => {
    repo = {
      findById: vi.fn().mockResolvedValue({ id: "asst-1", type: "assistants", title: "T", content: BOUND }),
      bindContent: vi.fn().mockResolvedValue(undefined),
    };
    assistantMessages = {
      createFromDTO: vi
        .fn()
        .mockImplementation(
          async (dto: {
            data: { attributes: { role: string }; relationships: { assistant: { data: { id: string } } } };
          }) => {
            order.push(`message:${dto.data.attributes.role}`);
            messageAssistantIds.push(dto.data.relationships.assistant.data.id);
            return { data: {} };
          },
        ),
    };
    assistantMessageRepo = {
      findById: vi.fn().mockImplementation(async ({ id }: { id: string }) => ({ id, type: "assistant-messages" })),
      getNextPosition: vi.fn().mockResolvedValue(2),
      linkReferences: vi.fn().mockResolvedValue(undefined),
      linkCitations: vi.fn().mockResolvedValue(undefined),
      setTrace: vi.fn().mockResolvedValue(undefined),
    };
    userModules = { findModuleIdsForUser: vi.fn().mockResolvedValue(["m-1"]) };
    jsonApi = { buildSingle: vi.fn().mockResolvedValue({ data: {} }) };
    webSocketService = { sendMessageToUser: vi.fn().mockResolvedValue(undefined) };
    clsService = {
      get: vi
        .fn()
        .mockImplementation((key: string) => (key === "userId" ? "u" : key === "companyId" ? "c" : undefined)),
      has: vi.fn().mockReturnValue(true),
      set: vi.fn(),
    };
    // `get` is overloaded, so a bare vi.fn() does not satisfy its Mocked type.
    configService = { get: vi.fn() as unknown as typeof configService.get };

    const service = new AssistantService(
      jsonApi as unknown as JsonApiService,
      repo as unknown as AssistantRepository,
      clsService as unknown as ClsService,
      userModules as unknown as UserModulesRepository,
      undefined as unknown as ResponderService, // runAgentTurn is stubbed
      assistantMessages as unknown as AssistantMessageService,
      assistantMessageRepo as unknown as AssistantMessageRepository,
      // A bound turn asks the catalog for its scope; no root means the turn runs unscoped.
      { getEntityDetail: vi.fn().mockReturnValue(undefined) } as unknown as GraphCatalogService,
      undefined as unknown as EntityServiceRegistry,
      undefined as unknown as OperatorService, // runOperatorTurn is stubbed
      undefined as unknown as AssistantActionService,
      undefined as unknown as AssistantActionRepository,
      webSocketService as unknown as WebSocketService,
      configService as unknown as ConfigService<BaseConfigInterface>,
      undefined as unknown as AssistantMentionExtractor, // plain-text input never reaches it
      undefined as unknown as BlockNoteService, // plain-text input never reaches it
      undefined as unknown as ScopeGuard,
      undefined,
      undefined,
      undefined,
      undefined,
      listener,
    );

    // Stub the turn and the bind validation: only the user-message hook is under test.
    vi.spyOn(service, "createFromDTO").mockResolvedValue(undefined);
    const internals = service as unknown as AssistantServiceInternals;
    vi.spyOn(internals, "validateBoundContent").mockResolvedValue("Campaign");
    vi.spyOn(internals, "loadRecentMessages").mockResolvedValue([]);
    vi.spyOn(internals, "runAgentTurn").mockImplementation(async () => {
      order.push("agentTurn");
      return TURN;
    });
    vi.spyOn(internals, "runOperatorTurn").mockImplementation(async () => {
      order.push("operatorTurn");
      return { kind: "completed" };
    });
    vi.spyOn(internals, "persistOperatorOutcome").mockResolvedValue({
      assistantMessage: { id: "am-1" },
      toolCalls: [],
    });

    return { service };
  };

  const makeListener = (): Mocked<AssistantUserMessageListener> => ({
    onUserMessage: vi.fn().mockImplementation(async () => {
      order.push("listener");
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    messageAssistantIds.length = 0;
  });

  it("notifies the listener once after the first user message is stored", async () => {
    const listener = makeListener();
    const { service } = buildSut(listener);

    const result = await service.createWithFirstMessage({
      companyId: "c",
      userId: "u",
      firstMessage: "hello",
      boundContent: BOUND,
    });

    expect(listener.onUserMessage).toHaveBeenCalledTimes(1);
    expect(listener.onUserMessage).toHaveBeenCalledWith({
      userId: "u",
      companyId: "c",
      assistantId: expect.any(String),
      boundContent: BOUND,
    });
    expect(listener.onUserMessage.mock.calls[0][0].assistantId).toBe(messageAssistantIds[0]);
    expect(order.indexOf("message:user")).toBeLessThan(order.indexOf("listener"));
    expect(order.indexOf("listener")).toBeLessThan(order.indexOf("agentTurn"));
    expect(result.userMessage).toBeDefined();
  });

  it("notifies with the thread's binding on appendMessage", async () => {
    const listener = makeListener();
    const { service } = buildSut(listener);

    await service.appendMessage({ assistantId: "asst-1", companyId: "c", userId: "u", newMessage: "again" });

    expect(listener.onUserMessage).toHaveBeenCalledTimes(1);
    expect(listener.onUserMessage).toHaveBeenCalledWith({
      userId: "u",
      companyId: "c",
      assistantId: "asst-1",
      boundContent: BOUND,
    });
    expect(order.indexOf("message:user")).toBeLessThan(order.indexOf("listener"));
  });

  it("notifies on both operator variants", async () => {
    const listener = makeListener();
    const { service } = buildSut(listener);

    await service.createWithFirstMessageOperator({
      companyId: "c",
      userId: "u",
      firstMessage: "do it",
      boundContent: BOUND,
    });
    await service.appendMessageOperator({ assistantId: "asst-1", companyId: "c", userId: "u", newMessage: "more" });

    expect(listener.onUserMessage).toHaveBeenCalledTimes(2);
    expect(listener.onUserMessage).toHaveBeenNthCalledWith(1, {
      userId: "u",
      companyId: "c",
      assistantId: expect.any(String),
      boundContent: BOUND,
    });
    expect(listener.onUserMessage).toHaveBeenNthCalledWith(2, {
      userId: "u",
      companyId: "c",
      assistantId: "asst-1",
      boundContent: BOUND,
    });
    expect(order.filter((step) => step === "listener")).toHaveLength(2);
    expect(order.indexOf("listener")).toBeLessThan(order.indexOf("operatorTurn"));
  });

  it("keeps the turn going when the listener rejects", async () => {
    const listener: Mocked<AssistantUserMessageListener> = {
      onUserMessage: vi.fn().mockImplementation(() => Promise.reject(new Error("x"))),
    };
    const { service } = buildSut(listener);

    const result = await service.createWithFirstMessage({ companyId: "c", userId: "u", firstMessage: "hello" });

    expect(listener.onUserMessage).toHaveBeenCalledTimes(1);
    expect(order).toContain("agentTurn");
    expect(result.assistantMessage).toBeDefined();
  });

  it("works with no listener bound", async () => {
    const { service } = buildSut();

    const result = await service.appendMessage({
      assistantId: "asst-1",
      companyId: "c",
      userId: "u",
      newMessage: "hi",
    });

    expect(order).toEqual(["message:user", "agentTurn", "message:assistant"]);
    expect(result.userMessage).toBeDefined();
  });
});
