import { ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantService, MAX_MESSAGES_TO_LLM } from "../services/assistant.service";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";

const COMPLETED_RESULT = {
  kind: "completed" as const,
  answer: "The operator answer",
  questions: ["What next?"],
  references: [{ type: "accounts", id: "acc-1", relevance: 85, reason: "hit" }],
  citations: [{ chunkId: "ch-1", relevance: 90, reason: "primary" }],
  toolCalls: [{ tool: "search_entities", input: {}, durationMs: 1 }],
  tokens: { input: 3, output: 4 },
};

const PENDING_RESULT = {
  kind: "pending_approval" as const,
  toolName: "operator_test_action",
  toolArgs: { sku: "X-1", quantity: 2 },
  summary: "Create a purchase order for 2 x X-1",
};

function makePersistedAssistant(title = "Hello there") {
  return {
    id: "asst-1",
    type: "assistants",
    title,
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

function makePersistedAction(overrides: Partial<any> = {}) {
  return {
    id: "act-1",
    type: "assistant-actions",
    status: "pending",
    toolName: "operator_test_action",
    toolArgs: JSON.stringify({ sku: "X-1", quantity: 2 }),
    summary: "Create a purchase order for 2 x X-1",
    threadId: "asst-1:um-1",
    userModuleIds: JSON.stringify(["11111111-1111-1111-1111-111111111111"]),
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("AssistantService — operator turns", () => {
  const buildSut = (
    opts: { priorMessages?: any[]; runResult?: any; resumeResult?: any; operatorConfig?: any } = {},
  ) => {
    const priorMessages = opts.priorMessages ?? [];

    const operator = {
      run: vi.fn(async () => opts.runResult ?? COMPLETED_RESULT),
      resume: vi.fn(async () => opts.resumeResult ?? COMPLETED_RESULT),
    } as any;

    const userModules = { findModuleIdsForUser: vi.fn(async () => ["11111111-1111-1111-1111-111111111111"]) } as any;
    const responder = { run: vi.fn() } as any;

    const createdMessages: any[] = [];
    const createdActions: any[] = [];
    const linkedRefs: any[] = [];
    const linkedCitations: any[] = [];

    const repo = {
      create: vi.fn(async () => undefined),
      find: vi.fn(async () => [makePersistedAssistant()]),
      findById: vi.fn(async () => makePersistedAssistant()),
    } as any;

    const assistantMessages = {
      createFromDTO: vi.fn(async (dto: any) => {
        createdMessages.push(dto);
        return { data: {} };
      }),
    } as any;

    const assistantMessageRepo = {
      linkReferences: vi.fn(async (args: any) => {
        linkedRefs.push(args);
      }),
      linkCitations: vi.fn(async (args: any) => {
        linkedCitations.push(args);
      }),
      setTrace: vi.fn(async () => undefined),
      getNextPosition: vi.fn(async () => priorMessages.length),
      findByRelated: vi.fn(async () => [...priorMessages].reverse()),
      findById: vi.fn(async ({ id }: any) => makePersistedMessage({ id })),
      findReferencedTypeIdPairs: vi.fn(async () => []),
    } as any;

    const assistantActions = {
      createPendingAction: vi.fn(async (p: any) => {
        createdActions.push(p);
        return makePersistedAction({
          id: p.id ?? `act-created-${createdActions.length}`,
          toolName: p.toolName,
          toolArgs: p.toolArgs,
          summary: p.summary,
          threadId: p.threadId,
          userModuleIds: p.userModuleIds,
          ...(p.contentScope !== undefined ? { contentScope: p.contentScope } : {}),
          expiresAt: p.expiresAt,
        });
      }),
    } as any;

    const assistantActionRepo = {
      findById: vi.fn(async ({ id }: any) => makePersistedAction({ id })),
      resolveStatus: vi.fn(async () => true),
    } as any;

    const webSocketService = { sendMessageToUser: vi.fn(async () => undefined) } as any;

    // App-level ConfigService: the operator block only exists when the host
    // app configures it — never on the optionless module-level baseConfig.
    const configService = {
      get: vi.fn((key: string) => (key === "operator" ? opts.operatorConfig : undefined)),
    } as any;

    const jsonApi = {
      buildSingle: vi.fn(async (_model: any, record: any) => ({
        data: { type: record.type, id: record.id, attributes: record },
      })),
      buildList: vi.fn(async (_model: any, records: any[]) => ({
        data: records.map((r) => ({ type: "assistant-messages", id: r.id, attributes: r })),
      })),
    } as any;

    const clsService = {
      get: (key: string) => (key === "userId" ? "u" : key === "companyId" ? "c" : undefined),
      has: () => true,
      set: vi.fn(),
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
    );

    return {
      service,
      operator,
      repo,
      jsonApi,
      assistantMessages,
      assistantMessageRepo,
      assistantActions,
      assistantActionRepo,
      webSocketService,
      configService,
      createdMessages,
      createdActions,
      linkedRefs,
      linkedCitations,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWithFirstMessageOperator — completed run", () => {
    it("persists user message at position 0 and assistant message at position 1 with the operator answer", async () => {
      const { service, assistantMessages, createdMessages } = buildSut();
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      const result = await service.createWithFirstMessageOperator({
        companyId: "c",
        userId: "u",
        firstMessage: "do something",
      });
      expect(assistantMessages.createFromDTO).toHaveBeenCalledTimes(2);
      expect(createdMessages[0].data.type).toBe(assistantMessageMeta.type);
      expect(createdMessages[0].data.attributes.role).toBe("user");
      expect(createdMessages[0].data.attributes.position).toBe(0);
      expect(createdMessages[1].data.attributes.role).toBe("assistant");
      expect(createdMessages[1].data.attributes.position).toBe(1);
      expect(createdMessages[1].data.attributes.content).toBe("The operator answer");
      expect(createdMessages[1].data.attributes.suggestedQuestions).toEqual(["What next?"]);
      expect(createdMessages[1].data.attributes.inputTokens).toBe(3);
      expect(createdMessages[1].data.attributes.outputTokens).toBe(4);
      expect(result.assistant.id).toBeDefined();
      expect(result.userMessage.id).toBeDefined();
      expect(result.assistantMessage.id).toBeDefined();
      expect(result.toolCalls).toEqual(COMPLETED_RESULT.toolCalls);
      expect(result.action).toBeUndefined();
    });

    it("links references and citations exactly like the responder path", async () => {
      const { service, assistantMessageRepo, linkedRefs, linkedCitations } = buildSut();
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: "go" });
      expect(assistantMessageRepo.linkReferences).toHaveBeenCalledTimes(1);
      expect(linkedRefs[0].references).toEqual(COMPLETED_RESULT.references);
      expect(assistantMessageRepo.linkCitations).toHaveBeenCalledTimes(1);
      expect(linkedCitations[0].citations).toEqual([{ chunkId: "ch-1", relevance: 90, reason: "primary" }]);
    });

    it('persists `engine: "operator"` on the created assistant', async () => {
      const { service } = buildSut();
      const createSpy = vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: "go" });
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0][0].data.attributes).toEqual(expect.objectContaining({ engine: "operator" }));
    });

    it("invokes operator.run with threadId `${assistantId}:${userMessageId}` and the question", async () => {
      const { service, operator, createdMessages } = buildSut();
      const createSpy = vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: "go" });
      const assistantId = createSpy.mock.calls[0][0].data.id;
      const userMessageId = createdMessages[0].data.id;
      expect(operator.run).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "c",
          userId: "u",
          userModuleIds: ["11111111-1111-1111-1111-111111111111"],
          question: "go",
          threadId: `${assistantId}:${userMessageId}`,
        }),
      );
    });
  });

  describe("appendMessageOperator", () => {
    it("completed run creates user + assistant messages at N and N+1 like appendMessage", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "m-0", role: "user", content: "x", position: 0 }),
        makePersistedMessage({ id: "m-1", role: "assistant", content: "y", position: 1 }),
      ];
      const { service, createdMessages } = buildSut({ priorMessages });
      const result = await service.appendMessageOperator({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        newMessage: "next step",
      });
      expect(createdMessages[0].data.attributes.role).toBe("user");
      expect(createdMessages[0].data.attributes.position).toBe(2);
      expect(createdMessages[1].data.attributes.role).toBe("assistant");
      expect(createdMessages[1].data.attributes.position).toBe(3);
      expect(createdMessages[1].data.attributes.content).toBe("The operator answer");
      expect(result.userMessage.id).toBeDefined();
      expect(result.assistantMessage.id).toBeDefined();
      expect(result.toolCalls).toEqual(COMPLETED_RESULT.toolCalls);
      expect(result.action).toBeUndefined();
    });

    it("trims history to MAX_MESSAGES_TO_LLM prior messages before the new user message", async () => {
      const priorMessages = Array.from({ length: 25 }, (_, i) =>
        makePersistedMessage({
          id: `m-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg-${i}`,
          position: i,
        }),
      );
      const { service, operator } = buildSut({ priorMessages });
      await service.appendMessageOperator({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        newMessage: "latest",
      });
      const passed = operator.run.mock.calls[0][0].messages;
      expect(passed.every((m: any) => m.type !== AgentMessageType.System)).toBe(true);
      expect(passed).toHaveLength(MAX_MESSAGES_TO_LLM + 1);
      expect(passed[0].content).toBe("msg-5");
      expect(passed[passed.length - 1].content).toBe("latest");
    });

    it("emits the same hydration system message as the responder path when priors carry references", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "u0", role: "user", content: "first", position: 0 }),
        makePersistedMessage({ id: "a0", role: "assistant", content: "answer", position: 1 }),
      ];
      const { service, operator, assistantMessageRepo } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" },
      ]);
      await service.appendMessageOperator({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        newMessage: "follow-up",
      });
      const sys = operator.run.mock.calls[0][0].messages.find((m: any) => m.type === AgentMessageType.System);
      expect(sys).toBeDefined();
      expect(sys.content).toContain('"id": "acc-1"');
    });

    it("pending_approval creates an approval-request assistant message carrying the summary", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "m-0", role: "user", content: "x", position: 0 }),
        makePersistedMessage({ id: "m-1", role: "assistant", content: "y", position: 1 }),
      ];
      const { service, createdMessages, assistantMessageRepo } = buildSut({
        priorMessages,
        runResult: PENDING_RESULT,
      });
      const result = await service.appendMessageOperator({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        newMessage: "buy it",
      });
      expect(createdMessages[1].data.attributes.role).toBe("assistant");
      expect(createdMessages[1].data.attributes.position).toBe(3);
      expect(createdMessages[1].data.attributes.messageType).toBe("approval-request");
      expect(createdMessages[1].data.attributes.content).toBe(PENDING_RESULT.summary);
      // no references/citations exist on a frozen run
      expect(assistantMessageRepo.linkReferences).not.toHaveBeenCalled();
      expect(assistantMessageRepo.linkCitations).not.toHaveBeenCalled();
      expect(result.toolCalls).toEqual([]);
      expect(result.action).toBeDefined();
    });

    it("pending_approval creates a pending AssistantAction with TTL expiry, threadId and message link", async () => {
      const { service, createdActions, createdMessages, assistantActions } = buildSut({
        runResult: PENDING_RESULT,
      });
      const before = Date.now();
      const result = await service.appendMessageOperator({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        newMessage: "buy it",
      });
      const after = Date.now();
      // pending-action assembly has one owner: AssistantActionService.createPendingAction
      expect(assistantActions.createPendingAction).toHaveBeenCalledTimes(1);
      expect(createdActions).toHaveLength(1);
      const p = createdActions[0];
      expect(p.toolName).toBe("operator_test_action");
      expect(JSON.parse(p.toolArgs)).toEqual(PENDING_RESULT.toolArgs);
      expect(p.summary).toBe(PENDING_RESULT.summary);
      expect(JSON.parse(p.userModuleIds)).toEqual(["11111111-1111-1111-1111-111111111111"]);
      const userMessageId = createdMessages[0].data.id;
      expect(p.threadId).toBe(`asst-1:${userMessageId}`);
      // expiresAt = now + 7 days (default TTL)
      const expiresAt = new Date(p.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * 86_400_000 - 5_000);
      expect(expiresAt).toBeLessThanOrEqual(after + 7 * 86_400_000 + 5_000);
      // linked to the approval-request message and to the assistant
      expect(p.messageId).toBe(createdMessages[1].data.id);
      expect(p.assistantId).toBe("asst-1");
      // the action returned to the caller is the one createPendingAction produced
      expect(result.action!.toolName).toBe("operator_test_action");
    });

    it("pending_approval honours operator.approvalTtlDays from the app ConfigService", async () => {
      const { service, createdActions, configService } = buildSut({
        runResult: PENDING_RESULT,
        operatorConfig: { approvalTtlDays: 3 },
      });
      const before = Date.now();
      await service.appendMessageOperator({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        newMessage: "buy it",
      });
      const after = Date.now();
      expect(configService.get).toHaveBeenCalledWith("operator");
      // expiresAt = now + 3 days (configured TTL), NOT the default 7
      const expiresAt = new Date(createdActions[0].expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 3 * 86_400_000 - 5_000);
      expect(expiresAt).toBeLessThanOrEqual(after + 3 * 86_400_000 + 5_000);
    });
  });

  describe("resolveAction", () => {
    it("approve: guards the status first, resumes, appends the final message at getNextPosition and marks executed", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "m-0", position: 0 }),
        makePersistedMessage({ id: "m-1", position: 1 }),
        makePersistedMessage({ id: "m-2", position: 2 }),
        makePersistedMessage({ id: "m-3", position: 3 }),
      ];
      const { service, operator, assistantActionRepo, assistantMessageRepo, createdMessages } = buildSut({
        priorMessages,
      });
      const result = await service.resolveAction({ actionId: "act-1", approved: true });

      // resolveStatus(pending → approved) happens BEFORE operator.resume
      expect(assistantActionRepo.resolveStatus).toHaveBeenCalledWith({
        id: "act-1",
        from: "pending",
        to: "approved",
      });
      const guardOrder = (assistantActionRepo.resolveStatus as any).mock.invocationCallOrder[0];
      const resumeOrder = (operator.resume as any).mock.invocationCallOrder[0];
      expect(guardOrder).toBeLessThan(resumeOrder);

      expect(operator.resume).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "asst-1:um-1",
          approved: true,
          companyId: "c",
          userId: "u",
          userModuleIds: ["11111111-1111-1111-1111-111111111111"],
        }),
      );

      // final assistant message appended at the current end of the thread
      expect(assistantMessageRepo.getNextPosition).toHaveBeenCalledWith({ assistantId: "asst-1" });
      expect(createdMessages).toHaveLength(1);
      expect(createdMessages[0].data.attributes.role).toBe("assistant");
      expect(createdMessages[0].data.attributes.position).toBe(4);
      expect(createdMessages[0].data.attributes.content).toBe("The operator answer");

      // action transitioned approved → executed
      expect(assistantActionRepo.resolveStatus).toHaveBeenCalledWith({
        id: "act-1",
        from: "approved",
        to: "executed",
      });

      expect(result.assistantMessage.id).toBeDefined();
      expect(result.action).toBeDefined();
    });

    it("approve: pushes the final message to the user over websocket as assistant:message", async () => {
      const { service, webSocketService } = buildSut();
      await service.resolveAction({ actionId: "act-1", approved: true });
      expect(webSocketService.sendMessageToUser).toHaveBeenCalledTimes(1);
      const [userId, event, payload] = (webSocketService.sendMessageToUser as any).mock.calls[0];
      expect(userId).toBe("u");
      expect(event).toBe("assistant:message");
      expect(payload).toBeDefined();
    });

    it("deny: transitions pending → denied, resumes with approved=false and never marks executed", async () => {
      const { service, operator, assistantActionRepo } = buildSut();
      await service.resolveAction({ actionId: "act-1", approved: false });
      expect(assistantActionRepo.resolveStatus).toHaveBeenCalledWith({ id: "act-1", from: "pending", to: "denied" });
      expect(operator.resume).toHaveBeenCalledWith(expect.objectContaining({ approved: false }));
      const toStatuses = (assistantActionRepo.resolveStatus as any).mock.calls.map((c: any[]) => c[0].to);
      expect(toStatuses).not.toContain("executed");
    });

    it("throws 409 ConflictException and never resumes when the status guard fails", async () => {
      const { service, operator, assistantActionRepo } = buildSut();
      (assistantActionRepo.resolveStatus as any).mockResolvedValue(false);
      await expect(service.resolveAction({ actionId: "act-1", approved: true })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(operator.resume).not.toHaveBeenCalled();
    });

    it("marks the action failed and throws 409 when resume fails (expired/missing checkpoint)", async () => {
      const { service, assistantActionRepo, assistantMessages, operator } = buildSut();
      (operator.resume as any).mockRejectedValue(new Error("no checkpoint found"));
      await expect(service.resolveAction({ actionId: "act-1", approved: true })).rejects.toThrow(
        "Could not resume this action — please ask again.",
      );
      expect(assistantActionRepo.resolveStatus).toHaveBeenCalledWith({ id: "act-1", from: "approved", to: "failed" });
      expect(assistantMessages.createFromDTO).not.toHaveBeenCalled();
    });

    it("resume returning a second pending_approval creates a new pending action and marks the original executed", async () => {
      const { service, createdActions, createdMessages, assistantActionRepo, assistantActions } = buildSut({
        resumeResult: PENDING_RESULT,
      });
      const result = await service.resolveAction({ actionId: "act-1", approved: true });
      expect(assistantActionRepo.resolveStatus).toHaveBeenCalledWith({
        id: "act-1",
        from: "approved",
        to: "executed",
      });
      expect(assistantActions.createPendingAction).toHaveBeenCalledTimes(1);
      expect(createdActions).toHaveLength(1);
      expect(createdMessages[0].data.attributes.messageType).toBe("approval-request");
      // the new pending action (not the executed original) is returned
      expect(result.action.toolName).toBe(PENDING_RESULT.toolName);
      expect(result.action.id).not.toBe("act-1");
    });

    it("marks the action executed immediately after resume returns, before any persistence", async () => {
      const { service, assistantActionRepo, assistantMessages, assistantMessageRepo } = buildSut();
      await service.resolveAction({ actionId: "act-1", approved: true });
      const calls = (assistantActionRepo.resolveStatus as any).mock.calls;
      const executedIdx = calls.findIndex((c: any[]) => c[0].to === "executed");
      expect(executedIdx).toBeGreaterThanOrEqual(0);
      const executedOrder = (assistantActionRepo.resolveStatus as any).mock.invocationCallOrder[executedIdx];
      const nextPositionOrder = (assistantMessageRepo.getNextPosition as any).mock.invocationCallOrder[0];
      const persistOrder = (assistantMessages.createFromDTO as any).mock.invocationCallOrder[0];
      expect(executedOrder).toBeLessThan(nextPositionOrder);
      expect(executedOrder).toBeLessThan(persistOrder);
    });

    it("keeps the action executed and rethrows when persistence fails after an approved resume", async () => {
      const { service, assistantActionRepo, assistantMessages, webSocketService } = buildSut();
      (assistantMessages.createFromDTO as any).mockRejectedValue(new Error("db down"));
      await expect(service.resolveAction({ actionId: "act-1", approved: true })).rejects.toThrow("db down");
      // the tool DID run: the status transitioned to executed and never to failed
      expect(assistantActionRepo.resolveStatus).toHaveBeenCalledWith({
        id: "act-1",
        from: "approved",
        to: "executed",
      });
      const toStatuses = (assistantActionRepo.resolveStatus as any).mock.calls.map((c: any[]) => c[0].to);
      expect(toStatuses).not.toContain("failed");
      expect(webSocketService.sendMessageToUser).not.toHaveBeenCalled();
    });

    it("does not fail the request when the websocket push throws (best-effort live update)", async () => {
      const { service, webSocketService, assistantActionRepo } = buildSut();
      (webSocketService.sendMessageToUser as any).mockRejectedValue(new Error("transport closed"));
      const result = await service.resolveAction({ actionId: "act-1", approved: true });
      expect(result.assistantMessage.id).toBeDefined();
      expect(result.action).toBeDefined();
      expect(assistantActionRepo.resolveStatus).toHaveBeenCalledWith({
        id: "act-1",
        from: "approved",
        to: "executed",
      });
    });

    it("passes contentId/contentType from the action's contentScope and the trimmed thread messages to resume", async () => {
      const priorMessages = Array.from({ length: 25 }, (_, i) =>
        makePersistedMessage({
          id: `m-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg-${i}`,
          position: i,
        }),
      );
      const { service, operator, assistantActionRepo } = buildSut({ priorMessages });
      (assistantActionRepo.findById as any).mockResolvedValue(
        makePersistedAction({
          contentScope: JSON.stringify({ contentId: "doc-1", contentType: "documents" }),
        }),
      );
      await service.resolveAction({ actionId: "act-1", approved: true });
      expect(operator.resume).toHaveBeenCalledWith(
        expect.objectContaining({ contentId: "doc-1", contentType: "documents" }),
      );
      const messages = (operator.resume as any).mock.calls[0][0].messages;
      expect(messages).toHaveLength(MAX_MESSAGES_TO_LLM);
      expect(messages[0]).toEqual({ type: AgentMessageType.Assistant, content: "msg-5" });
      expect(messages[messages.length - 1]).toEqual({ type: AgentMessageType.User, content: "msg-24" });
    });

    it("defaults to empty userModuleIds and no content scope when stored JSON fields are corrupt", async () => {
      const { service, operator, assistantActionRepo } = buildSut();
      (assistantActionRepo.findById as any).mockResolvedValue(
        makePersistedAction({ userModuleIds: "{not-json", contentScope: "{broken" }),
      );
      const result = await service.resolveAction({ actionId: "act-1", approved: true });
      expect(operator.resume).toHaveBeenCalledWith(
        expect.objectContaining({ userModuleIds: [], contentId: undefined, contentType: undefined }),
      );
      expect(result.assistantMessage.id).toBeDefined();
    });
  });
});
