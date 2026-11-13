import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import { UserModulesRepository } from "../../../../agents/graph/repositories/user-modules.repository";
import { GraphCatalogService } from "../../../../agents/graph/services/graph.catalog.service";
import { ScopeGuard } from "../../../../agents/graph/services/scope.guard";
import { OperatorService } from "../../../../agents/operator/services/operator.service";
import { ResponderService } from "../../../../agents/responder/services/responder.service";
import { AssistantSeedContextProvider } from "../../../../common/interfaces/seed.context.interface";
import { EntityServiceRegistry } from "../../../../common/registries/entity.service.registry";
import { BaseConfigInterface } from "../../../../config/interfaces/base.config.interface";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { WebSocketService } from "../../../../core/websocket/services/websocket.service";
import { AssistantActionRepository } from "../../../assistant-action/repositories/assistant-action.repository";
import { AssistantActionService } from "../../../assistant-action/services/assistant-action.service";
import { AssistantMessageRepository } from "../../../assistant-message/repositories/assistant-message.repository";
import { AssistantMessageService } from "../../../assistant-message/services/assistant-message.service";
import { AssistantRepository } from "../../repositories/assistant.repository";
import { AssistantMentionExtractor } from "../assistant-mention.extractor";
import { AssistantService } from "../assistant.service";

/** Private helpers around the hook, stubbed so only the client context path is under test. */
type AssistantServiceInternals = {
  validateBoundContent: () => Promise<string | undefined>;
  loadRecentMessages: () => Promise<unknown[]>;
  buildHydrationMessage: () => Promise<string | null>;
  persistOperatorOutcome: () => Promise<unknown>;
};

type CreatedMessage = { data: { id: string; attributes: Record<string, unknown> } };

describe("AssistantService: bound content type", () => {
  let repo: Mocked<Pick<AssistantRepository, "findById" | "bindContent">>;
  let assistantMessages: Mocked<Pick<AssistantMessageService, "createFromDTO">>;
  let assistantMessageRepo: Mocked<
    Pick<AssistantMessageRepository, "findById" | "getNextPosition" | "linkReferences" | "linkCitations" | "setTrace">
  >;
  let assistantActionRepo: Mocked<Pick<AssistantActionRepository, "findById" | "resolveStatus">>;
  let userModules: Mocked<Pick<UserModulesRepository, "findModuleIdsForUser">>;
  let operator: Mocked<Pick<OperatorService, "run" | "resume">>;
  let responder: Mocked<Pick<ResponderService, "run">>;
  let provider: Mocked<AssistantSeedContextProvider>;
  let clsService: Mocked<Pick<ClsService, "get" | "has" | "set">>;
  let configService: Mocked<Pick<ConfigService<BaseConfigInterface>, "get">>;

  const ROOT = {
    type: "widgets",
    moduleId: "mod-1",
    labelName: "Widget",
    scope: { path: [], rootType: "widgets", rootLabel: "Widget" },
  };
  // A second descriptor of the same label that is not a scope root.
  const VIEW = { type: "widget-views", moduleId: "mod-1", labelName: "Widget" };
  const catalog = {
    hasType: vi.fn((type: string) => type === ROOT.type || type === VIEW.type),
    getAllEntities: vi.fn(() => [VIEW, ROOT]),
    getEntityDetail: vi.fn((type: string) => (type === ROOT.type ? ROOT : type === VIEW.type ? VIEW : null)),
  };

  const buildSut = () => {
    repo = {
      findById: vi.fn().mockResolvedValue({
        id: "a-1",
        type: "assistants",
        title: "T",
        // The hydrated BOUND_TO target: its type is its first Neo4j label, lowercased.
        content: { id: "w-1", type: "widget", labels: ["Widget"] },
      }),
      bindContent: vi.fn().mockResolvedValue(undefined),
    };
    assistantMessages = { createFromDTO: vi.fn().mockResolvedValue({ data: {} }) };
    assistantMessageRepo = {
      findById: vi.fn().mockImplementation(async ({ id }: { id: string }) => ({ id, type: "assistant-messages" })),
      getNextPosition: vi.fn().mockResolvedValue(2),
      linkReferences: vi.fn().mockResolvedValue(undefined),
      linkCitations: vi.fn().mockResolvedValue(undefined),
      setTrace: vi.fn().mockResolvedValue(undefined),
    };
    assistantActionRepo = {
      findById: vi.fn().mockResolvedValue({ id: "act-1", threadId: "a-1:m-1", userModuleIds: "[]" }),
      resolveStatus: vi.fn().mockResolvedValue(true),
    };
    userModules = { findModuleIdsForUser: vi.fn().mockResolvedValue(["mod-1"]) };
    operator = {
      run: vi.fn().mockResolvedValue({ kind: "completed" }),
      resume: vi.fn().mockResolvedValue({ kind: "completed" }),
    };
    responder = {
      run: vi.fn().mockResolvedValue({ answer: { answer: "ok", questions: [] }, tokens: { input: 1, output: 1 } }),
    };
    provider = { provide: vi.fn().mockResolvedValue(null) };
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
      { buildSingle: vi.fn().mockResolvedValue({ data: {} }) } as unknown as JsonApiService,
      repo as unknown as AssistantRepository,
      clsService as unknown as ClsService,
      userModules as unknown as UserModulesRepository,
      responder as unknown as ResponderService,
      assistantMessages as unknown as AssistantMessageService,
      assistantMessageRepo as unknown as AssistantMessageRepository,
      catalog as unknown as GraphCatalogService,
      undefined as unknown as EntityServiceRegistry,
      operator as unknown as OperatorService,
      undefined as unknown as AssistantActionService,
      assistantActionRepo as unknown as AssistantActionRepository,
      { sendMessageToUser: vi.fn().mockResolvedValue(undefined) } as unknown as WebSocketService,
      configService as unknown as ConfigService<BaseConfigInterface>,
      undefined as unknown as AssistantMentionExtractor, // plain-text input never reaches it
      undefined as unknown as BlockNoteService, // plain-text input never reaches it
      undefined as unknown as ScopeGuard,
      [provider],
    );

    vi.spyOn(service, "createFromDTO").mockResolvedValue(undefined);
    const internals = service as unknown as AssistantServiceInternals;
    vi.spyOn(internals, "validateBoundContent").mockResolvedValue(undefined);
    vi.spyOn(internals, "loadRecentMessages").mockResolvedValue([]);
    vi.spyOn(internals, "buildHydrationMessage").mockResolvedValue(null);
    vi.spyOn(internals, "persistOperatorOutcome").mockResolvedValue({
      assistantMessage: { id: "am-1" },
      toolCalls: [],
    });

    return { service };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("findBoundContent answers the catalogued JSON:API type of the bound record, not its Neo4j label", async () => {
    const { service } = buildSut();
    expect(await service.findBoundContent({ assistantId: "a-1" })).toEqual({ id: "w-1", type: "widgets" });
  });

  it("findBoundContent keeps a type the catalog already knows", async () => {
    const { service } = buildSut();
    repo.findById.mockResolvedValue({
      id: "a-1",
      type: "assistants",
      content: { id: "w-1", type: "widget-views" },
    } as never);
    expect(await service.findBoundContent({ assistantId: "a-1" })).toEqual({ id: "w-1", type: "widget-views" });
  });

  it("an append to a bound thread runs scoped to the bound record and hands that scope to seed providers", async () => {
    const { service } = buildSut();

    await service.appendMessageOperator({ assistantId: "a-1", companyId: "c", userId: "u", newMessage: "hi" });

    expect(operator.run).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: "widgets", scopeId: "w-1", contentType: "widgets", contentId: "w-1" }),
    );
    expect(provider.provide).toHaveBeenCalledWith(expect.objectContaining({ scopeType: "widgets", scopeId: "w-1" }));
  });
});
