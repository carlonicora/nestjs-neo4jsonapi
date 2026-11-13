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

describe("AssistantService: client context", () => {
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

  const buildSut = () => {
    repo = {
      findById: vi.fn().mockResolvedValue({ id: "a-1", type: "assistants", title: "T" }),
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
      { getEntityDetail: vi.fn().mockReturnValue(undefined) } as unknown as GraphCatalogService,
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

  const firstCreated = (): CreatedMessage =>
    assistantMessages.createFromDTO.mock.calls[0][0] as unknown as CreatedMessage;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appendMessageOperator stores clientContext as a JSON string on the user message", async () => {
    const { service } = buildSut();

    await service.appendMessageOperator({
      assistantId: "a-1",
      companyId: "c",
      userId: "u",
      newMessage: "hi",
      clientContext: { k: "v" },
    });

    expect(firstCreated().data.attributes.clientContext).toBe(JSON.stringify({ k: "v" }));
  });

  it("appendMessageOperator without clientContext writes no clientContext attribute", async () => {
    const { service } = buildSut();

    await service.appendMessageOperator({ assistantId: "a-1", companyId: "c", userId: "u", newMessage: "hi" });

    expect(firstCreated().data.attributes).not.toHaveProperty("clientContext");
  });

  it("appendMessageOperator rejects an invalid clientContext with 400 invalid_client_context before any write", async () => {
    const { service } = buildSut();

    await expect(
      service.appendMessageOperator({
        assistantId: "a-1",
        companyId: "c",
        userId: "u",
        newMessage: "hi",
        clientContext: { k: 1 } as unknown as Record<string, string>,
      }),
    ).rejects.toThrow(new BadRequestException("invalid_client_context"));
    expect(assistantMessages.createFromDTO).not.toHaveBeenCalled();
  });

  it("createWithFirstMessageOperator hands clientContext and userMessageId to operator.run and assistantId + clientContext to every seed provider", async () => {
    const { service } = buildSut();

    await service.createWithFirstMessageOperator({
      companyId: "c",
      userId: "u",
      firstMessage: "hi",
      title: "T",
      clientContext: { k: "v" },
    });

    const created = firstCreated();
    const runParams = operator.run.mock.calls[0][0];
    expect(runParams.clientContext).toEqual({ k: "v" });
    expect(runParams.userMessageId).toBe(created.data.id);
    expect(runParams.threadId).toBe(`${runParams.assistantId}:${created.data.id}`);
    expect(provider.provide).toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: runParams.assistantId, clientContext: { k: "v" } }),
    );
  });

  it("appendMessage (responder) hands clientContext and assistantId to every seed provider", async () => {
    const { service } = buildSut();

    await service.appendMessage({
      assistantId: "a-1",
      companyId: "c",
      userId: "u",
      newMessage: "hi",
      clientContext: { k: "v" },
    });

    expect(provider.provide).toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: "a-1", clientContext: { k: "v" } }),
    );
    expect(firstCreated().data.attributes.clientContext).toBe(JSON.stringify({ k: "v" }));
  });

  it("resolveAction reads the clientContext of the message named by the threadId and passes it to seed providers and operator.resume", async () => {
    const { service } = buildSut();
    assistantMessageRepo.findById.mockImplementation(async ({ id }: { id: string }) =>
      id === "m-1" ? ({ id, clientContext: '{"k":"v"}' } as never) : ({ id, type: "assistant-messages" } as never),
    );

    await service.resolveAction({ actionId: "act-1", approved: true });

    expect(assistantMessageRepo.findById).toHaveBeenCalledWith({ id: "m-1" });
    expect(provider.provide).toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: "a-1", clientContext: { k: "v" } }),
    );
    expect(operator.resume).toHaveBeenCalledWith(
      expect.objectContaining({ clientContext: { k: "v" }, userMessageId: "m-1", assistantId: "a-1" }),
    );
  });

  it("resolveAction proceeds without clientContext when the message read fails", async () => {
    const { service } = buildSut();
    assistantMessageRepo.findById.mockImplementation(async ({ id }: { id: string }) => {
      if (id === "m-1") throw new Error("not found");
      return { id, type: "assistant-messages" } as never;
    });

    await service.resolveAction({ actionId: "act-1", approved: true });

    const resumeParams = operator.resume.mock.calls[0][0];
    expect(resumeParams.clientContext).toBeUndefined();
    expect(resumeParams.userMessageId).toBe("m-1");
  });
});
