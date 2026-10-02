import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantService } from "../services/assistant.service";
import { AssistantDescriptor } from "../entities/assistant";
import { assistantMeta } from "../entities/assistant.meta";

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

function makePersistedAssistant() {
  return {
    id: "asst-1",
    type: "assistants",
    title: "Generated title",
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("AssistantService — early thread title and assistant:created event", () => {
  const order: string[] = [];

  const buildSut = (opts: { titleGenerator?: { generate: ReturnType<typeof vi.fn> } } = {}) => {
    const repo = {
      findById: vi.fn(async () => makePersistedAssistant()),
      bindContent: vi.fn(async () => undefined),
    } as any;
    const assistantMessages = { createFromDTO: vi.fn(async () => ({ data: {} })) } as any;
    const assistantMessageRepo = {
      linkReferences: vi.fn(async () => undefined),
      linkCitations: vi.fn(async () => undefined),
      setTrace: vi.fn(async () => undefined),
      findById: vi.fn(async ({ id }: any) => ({ id, type: "assistant-messages" })),
    } as any;
    const userModules = { findModuleIdsForUser: vi.fn(async () => ["m-1"]) } as any;
    const document = { data: { type: "assistants", id: "asst-1", attributes: { title: "Generated title" } } };
    const jsonApi = { buildSingle: vi.fn(async () => document) } as any;
    const webSocketService = {
      sendMessageToUser: vi.fn(async (_userId: string, event: string) => {
        order.push(`ws:${event}`);
      }),
    } as any;
    const clsService = {
      get: (key: string) => (key === "userId" ? "u" : key === "companyId" ? "c" : undefined),
      has: () => true,
      set: vi.fn(),
    } as any;

    const service = new AssistantService(
      jsonApi,
      repo,
      clsService,
      userModules,
      undefined as any, // responder — runAgentTurn is stubbed
      assistantMessages,
      assistantMessageRepo,
      undefined as any, // graphCatalog
      undefined as any, // entityServices
      undefined as any, // operator — runOperatorTurn is stubbed
      undefined as any, // assistantActions
      undefined as any, // assistantActionRepo
      webSocketService,
      { get: vi.fn() } as any,
      undefined as any, // mentions
      undefined as any, // blockNote
      undefined as any, // scopeGuard
      undefined,
      undefined,
      undefined,
      opts.titleGenerator as any,
    );

    vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
    const patchFromDTO = vi.spyOn(service as any, "patchFromDTO").mockImplementation(async () => {
      order.push("patch");
      return { data: {} };
    });
    const runAgentTurn = vi.spyOn(service as any, "runAgentTurn").mockImplementation(async () => {
      order.push("agentTurn");
      return TURN;
    });
    const runOperatorTurn = vi.spyOn(service as any, "runOperatorTurn").mockImplementation(async () => {
      order.push("operatorTurn");
      return { kind: "completed" };
    });
    vi.spyOn(service as any, "persistOperatorOutcome").mockResolvedValue({
      assistantMessage: { id: "am-1" },
      toolCalls: [],
    });

    return { service, jsonApi, webSocketService, patchFromDTO, runAgentTurn, runOperatorTurn, document };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
  });

  it("stores the generated title and emits assistant:created before the agent turn", async () => {
    const titleGenerator = {
      generate: vi.fn(async () => {
        order.push("generate");
        return "  Generated title  ";
      }),
    };
    const { service, jsonApi, webSocketService, patchFromDTO, document } = buildSut({ titleGenerator });

    const result = await service.createWithFirstMessage({ companyId: "c", userId: "u", firstMessage: "hello there" });

    expect(titleGenerator.generate).toHaveBeenCalledWith({
      question: "hello there",
      userMessageId: expect.any(String),
      boundLabel: undefined,
    });
    expect(patchFromDTO).toHaveBeenCalledWith({
      data: { type: assistantMeta.type, id: expect.any(String), attributes: { title: "Generated title" } },
    });
    expect(jsonApi.buildSingle).toHaveBeenCalledWith(
      AssistantDescriptor.model,
      expect.objectContaining({ id: "asst-1" }),
    );
    expect(webSocketService.sendMessageToUser).toHaveBeenCalledWith("u", "assistant:created", { assistant: document });
    expect(order).toEqual(["generate", "patch", "ws:assistant:created", "agentTurn"]);
    expect(result.assistant.id).toBe("asst-1");
  });

  it("never calls the generator when the caller supplies a title", async () => {
    const titleGenerator = { generate: vi.fn(async () => "Other") };
    const { service, patchFromDTO, webSocketService } = buildSut({ titleGenerator });

    await service.createWithFirstMessage({ companyId: "c", userId: "u", firstMessage: "hello", title: "Mine" });

    expect(titleGenerator.generate).not.toHaveBeenCalled();
    expect(patchFromDTO).not.toHaveBeenCalled();
    expect(webSocketService.sendMessageToUser).toHaveBeenCalledWith("u", "assistant:created", expect.anything());
  });

  it("keeps the truncated-question title when the generator returns undefined", async () => {
    const titleGenerator = { generate: vi.fn(async () => undefined) };
    const { service, patchFromDTO, webSocketService } = buildSut({ titleGenerator });

    await service.createWithFirstMessage({ companyId: "c", userId: "u", firstMessage: "hello" });

    expect(patchFromDTO).not.toHaveBeenCalled();
    expect(webSocketService.sendMessageToUser).toHaveBeenCalledWith("u", "assistant:created", expect.anything());
  });

  it("keeps the truncated-question title and still succeeds when the generator throws", async () => {
    const titleGenerator = { generate: vi.fn(async () => Promise.reject(new Error("llm down"))) };
    const { service, patchFromDTO, runAgentTurn } = buildSut({ titleGenerator });

    const result = await service.createWithFirstMessage({ companyId: "c", userId: "u", firstMessage: "hello" });

    expect(patchFromDTO).not.toHaveBeenCalled();
    expect(runAgentTurn).toHaveBeenCalled();
    expect(result.assistant.id).toBe("asst-1");
  });

  it("emits with no generator bound and succeeds when the websocket push throws", async () => {
    const { service, webSocketService, runAgentTurn, patchFromDTO } = buildSut();
    webSocketService.sendMessageToUser.mockRejectedValueOnce(new Error("socket down"));

    const result = await service.createWithFirstMessage({ companyId: "c", userId: "u", firstMessage: "hello" });

    expect(patchFromDTO).not.toHaveBeenCalled();
    expect(webSocketService.sendMessageToUser).toHaveBeenCalledWith("u", "assistant:created", expect.anything());
    expect(runAgentTurn).toHaveBeenCalled();
    expect(result.assistant.id).toBe("asst-1");
  });

  it("operator create also titles the thread and emits before the operator turn", async () => {
    const titleGenerator = {
      generate: vi.fn(async () => {
        order.push("generate");
        return "Generated title";
      }),
    };
    const { service, webSocketService, document, runOperatorTurn } = buildSut({ titleGenerator });

    await service.createWithFirstMessageOperator({ companyId: "c", userId: "u", firstMessage: "do it" });

    expect(webSocketService.sendMessageToUser).toHaveBeenCalledWith("u", "assistant:created", { assistant: document });
    expect(runOperatorTurn).toHaveBeenCalled();
    expect(order).toEqual(["generate", "patch", "ws:assistant:created", "operatorTurn"]);
  });
});
