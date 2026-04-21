import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantService, MAX_MESSAGES_TO_LLM } from "../assistant.service";
import { assistantMeta } from "../../entities/assistant.meta";
import { assistantMessageMeta } from "../../../assistant-message/entities/assistant-message.meta";

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

describe("AssistantService", () => {
  const buildSut = (opts: { priorMessages?: any[] } = {}) => {
    const chatbotResponse = {
      answer: "The answer",
      references: [{ type: "accounts", id: "acc-1", reason: "hit" }],
      needsClarification: false,
      suggestedQuestions: [],
      tokens: { input: 1, output: 2 },
      toolCalls: [{ tool: "search_entities", input: {}, durationMs: 1 }],
      type: "assistant",
    };
    const chatbot = { run: vi.fn(async () => chatbotResponse) } as any;
    const userModules = { findModulesForRoles: vi.fn(async () => ["crm"]) } as any;

    const createdMessages: any[] = [];
    const linkedRefs: any[] = [];
    const priorMessages = opts.priorMessages ?? [];

    const repo = {
      create: vi.fn(async () => undefined),
      patch: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
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
      getNextPosition: vi.fn(async () => priorMessages.length),
      findByRelated: vi.fn(async () => [...priorMessages].reverse()),
      findById: vi.fn(async ({ id }: any) => makePersistedMessage({ id })),
    } as any;

    const jsonApi = {
      buildSingle: vi.fn(async (_model: any, record: any) => ({
        data: { type: "assistants", id: record.id, attributes: record },
      })),
      buildList: vi.fn(async (_model: any, records: any[]) => ({
        data: records.map((r) => ({ type: "assistant-messages", id: r.id, attributes: r })),
      })),
    } as any;

    const clsService = {
      get: (key: string) => (key === "userId" ? "u" : key === "companyId" ? "c" : undefined),
      has: () => true,
    } as any;

    const service = new AssistantService(
      jsonApi,
      repo,
      clsService,
      userModules,
      chatbot,
      assistantMessages,
      assistantMessageRepo,
    );
    return {
      service,
      chatbot,
      userModules,
      repo,
      jsonApi,
      assistantMessages,
      assistantMessageRepo,
      createdMessages,
      linkedRefs,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWithFirstMessage", () => {
    it("auto-generates a title from the first message when none is provided", async () => {
      const { service } = buildSut();
      const spy = vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "Can you show me all accounts from last month?",
      });
      const dtoArg = spy.mock.calls[0][0];
      expect(dtoArg.data.type).toBe(assistantMeta.type);
      expect(dtoArg.data.attributes.title).toBe("Can you show me all accounts from last month?");
    });

    it("trims an auto-title to <=60 chars on a word boundary", async () => {
      const { service } = buildSut();
      const spy = vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      const longMessage =
        "This is a deliberately long first message that should be trimmed on a word boundary somewhere before sixty";
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: longMessage,
      });
      const dtoArg = spy.mock.calls[0][0];
      const title = dtoArg.data.attributes.title as string;
      expect(title.length).toBeLessThanOrEqual(60);
      expect(longMessage.startsWith(title)).toBe(true);
      expect(longMessage[title.length]).toBe(" ");
    });

    it("respects a caller-supplied title when provided", async () => {
      const { service } = buildSut();
      const spy = vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "hi",
        title: "   My Custom Title   ",
      });
      expect(spy.mock.calls[0][0].data.attributes.title).toBe("My Custom Title");
    });

    it("does NOT emit a hydration system message on the first turn (no prior refs)", async () => {
      const { service, chatbot } = buildSut();
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "hello",
      });
      const passedMessages = chatbot.run.mock.calls[0][0].messages;
      expect(passedMessages.every((m: any) => m.role !== "system")).toBe(true);
    });

    it("creates user message at position 0 and assistant message at position 1 via AssistantMessageService", async () => {
      const { service, assistantMessages, createdMessages } = buildSut();
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "hi",
      });
      expect(assistantMessages.createFromDTO).toHaveBeenCalledTimes(2);
      expect(createdMessages[0].data.type).toBe(assistantMessageMeta.type);
      expect(createdMessages[0].data.attributes.role).toBe("user");
      expect(createdMessages[0].data.attributes.position).toBe(0);
      expect(createdMessages[1].data.attributes.role).toBe("assistant");
      expect(createdMessages[1].data.attributes.position).toBe(1);
      // references stored as stringified JSON snapshot
      expect(JSON.parse(createdMessages[1].data.attributes.references)).toEqual([
        { type: "accounts", id: "acc-1", reason: "hit" },
      ]);
    });

    it("materialises REFERENCES edges for the assistant turn via linkReferences", async () => {
      const { service, assistantMessageRepo, linkedRefs } = buildSut();
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "hi",
      });
      expect(assistantMessageRepo.linkReferences).toHaveBeenCalledTimes(1);
      expect(linkedRefs[0].references).toEqual([{ type: "accounts", id: "acc-1", reason: "hit" }]);
    });

    it("returns the Assistant plus the two new messages and propagated toolCalls", async () => {
      const { service } = buildSut();
      vi.spyOn(service as any, "createFromDTO").mockResolvedValue(undefined);
      const result = await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "hi",
      });
      expect(result.assistant.id).toBeDefined();
      expect(result.userMessage.id).toBeDefined();
      expect(result.assistantMessage.id).toBeDefined();
      expect(result.toolCalls).toEqual([{ tool: "search_entities", input: {}, durationMs: 1 }]);
    });
  });

  describe("appendMessage", () => {
    it("emits a reference-memory system message on the second turn when priors have refs", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "u0", role: "user", content: "first", position: 0 }),
        makePersistedMessage({
          id: "a0",
          role: "assistant",
          content: "answer",
          position: 1,
          references: JSON.stringify([{ type: "accounts", id: "acc-1", reason: "prior mention" }]),
        }),
      ];
      const { service, chatbot } = buildSut({ priorMessages });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "follow-up",
      });
      const passed = chatbot.run.mock.calls[0][0].messages;
      const sys = passed.find((m: any) => m.role === "system");
      expect(sys).toBeDefined();
      expect(sys.content).toContain("accounts/acc-1");
      expect(sys.content).toContain("prior mention");
    });

    it("deduplicates references across multiple prior turns", async () => {
      const priorMessages = [
        makePersistedMessage({
          id: "a0",
          role: "assistant",
          content: "a",
          position: 0,
          references: JSON.stringify([{ type: "accounts", id: "acc-1", reason: "first" }]),
        }),
        makePersistedMessage({
          id: "a1",
          role: "assistant",
          content: "b",
          position: 1,
          references: JSON.stringify([
            { type: "accounts", id: "acc-1", reason: "repeat" },
            { type: "orders", id: "ord-9", reason: "new" },
          ]),
        }),
      ];
      const { service, chatbot } = buildSut({ priorMessages });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "more",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      expect((sys.content.match(/accounts\/acc-1/g) ?? []).length).toBe(1);
      expect((sys.content.match(/orders\/ord-9/g) ?? []).length).toBe(1);
      expect(sys.content).toContain("accounts/acc-1: first");
    });

    it("trims history to at most MAX_MESSAGES_TO_LLM prior messages before the new user message", async () => {
      const priorMessages = Array.from({ length: 25 }, (_, i) =>
        makePersistedMessage({
          id: `m-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg-${i}`,
          position: i,
        }),
      );
      const { service, chatbot } = buildSut({ priorMessages });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "latest",
      });
      const passed = chatbot.run.mock.calls[0][0].messages;
      expect(passed.every((m: any) => m.role !== "system")).toBe(true);
      expect(passed).toHaveLength(MAX_MESSAGES_TO_LLM + 1);
      // loadRecentMessages returns newest-first then reverses, so the tail pulled is msg-5..msg-24
      expect(passed[0].content).toBe("msg-5");
      expect(passed[passed.length - 1].content).toBe("latest");
    });

    it("creates two child messages at position N and N+1 via AssistantMessageService", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "m-0", role: "user", content: "x", position: 0 }),
        makePersistedMessage({ id: "m-1", role: "assistant", content: "y", position: 1 }),
      ];
      const { service, assistantMessages, createdMessages } = buildSut({ priorMessages });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "hi",
      });
      expect(assistantMessages.createFromDTO).toHaveBeenCalledTimes(2);
      expect(createdMessages[0].data.attributes.position).toBe(2);
      expect(createdMessages[0].data.attributes.role).toBe("user");
      expect(createdMessages[1].data.attributes.position).toBe(3);
      expect(createdMessages[1].data.attributes.role).toBe("assistant");
    });

    it("returns the two new messages plus the turn's toolCalls", async () => {
      const { service } = buildSut();
      const result = await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "hi",
      });
      expect(result.userMessage.id).toBeDefined();
      expect(result.assistantMessage.id).toBeDefined();
      expect(result.toolCalls).toEqual([{ tool: "search_entities", input: {}, durationMs: 1 }]);
    });
  });
});
