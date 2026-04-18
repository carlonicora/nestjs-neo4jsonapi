import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationService, MAX_MESSAGES_TO_LLM } from "../conversation.service";

function makePersistedConvo(messages: any[] = [], title = "Hello there") {
  return {
    id: "convo-1",
    type: "assistants",
    title,
    messages: JSON.stringify(messages),
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("ConversationService", () => {
  const buildSut = (opts: { findReturns?: any } = {}) => {
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
    const repo = {
      create: vi.fn(async () => undefined),
      patch: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      find: vi.fn(async () => [makePersistedConvo()]),
      findById: vi.fn(async () => opts.findReturns ?? makePersistedConvo()),
    } as any;
    const jsonApi = {
      buildSingle: vi.fn(async (_model: any, record: any) => ({
        data: { type: "assistants", id: record.id, attributes: record },
      })),
      buildList: vi.fn(async (_model: any, records: any[]) => ({
        data: records.map((r) => ({ type: "assistants", id: r.id, attributes: r })),
      })),
    } as any;
    const clsService = {
      get: (key: string) => (key === "userId" ? "u" : key === "companyId" ? "c" : undefined),
      has: () => true,
    } as any;
    const service = new ConversationService(jsonApi, repo, clsService, userModules, chatbot);
    return { service, chatbot, userModules, repo, jsonApi };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWithFirstMessage", () => {
    it("auto-generates a title from the first message when none is provided", async () => {
      const { service, repo } = buildSut();
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "Can you show me all accounts from last month?",
      });
      const persisted = repo.create.mock.calls[0][0];
      expect(persisted.title).toBe("Can you show me all accounts from last month?");
    });

    it("trims an auto-title to <=60 chars on a word boundary", async () => {
      const { service, repo } = buildSut();
      const longMessage =
        "This is a deliberately long first message that should be trimmed on a word boundary somewhere before sixty";
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: longMessage,
      });
      const persisted = repo.create.mock.calls[0][0];
      expect(persisted.title.length).toBeLessThanOrEqual(60);
      // Title must be a prefix of the original input (no char cut) and end at a
      // word (the original has a space immediately after the cut point, meaning
      // we trimmed on a boundary).
      expect(longMessage.startsWith(persisted.title)).toBe(true);
      expect(longMessage[persisted.title.length]).toBe(" ");
    });

    it("respects a caller-supplied title when provided", async () => {
      const { service, repo } = buildSut();
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "hi",
        title: "   My Custom Title   ",
      });
      const persisted = repo.create.mock.calls[0][0];
      expect(persisted.title).toBe("My Custom Title");
    });

    it("does NOT emit a hydration system message on the first turn (no prior refs)", async () => {
      const { service, chatbot } = buildSut();
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "hello",
      });
      const passedMessages = chatbot.run.mock.calls[0][0].messages;
      expect(passedMessages.every((m: any) => m.role !== "system")).toBe(true);
    });

    it("persists the user+assistant pair as JSON.stringified messages", async () => {
      const { service, repo } = buildSut();
      await service.createWithFirstMessage({
        companyId: "c",
        userId: "u",
        roles: ["r"],
        firstMessage: "hi",
      });
      const persisted = repo.create.mock.calls[0][0];
      const parsed = JSON.parse(persisted.messages);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].role).toBe("user");
      expect(parsed[1].role).toBe("assistant");
      expect(parsed[1].references).toEqual([{ type: "accounts", id: "acc-1", reason: "hit" }]);
    });
  });

  describe("appendMessage", () => {
    it("emits a reference-memory system message on the second turn when priors have refs", async () => {
      const priorMessages = [
        { id: "u0", role: "user", content: "first", createdAt: "2026-04-17T00:00:00Z" },
        {
          id: "a0",
          role: "assistant",
          content: "answer",
          createdAt: "2026-04-17T00:00:01Z",
          references: [{ type: "accounts", id: "acc-1", reason: "prior mention" }],
        },
      ];
      const { service, chatbot } = buildSut({ findReturns: { ...makePersistedConvo(priorMessages) } });
      await service.appendMessage({
        conversationId: "convo-1",
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
        {
          id: "a0",
          role: "assistant",
          content: "a",
          createdAt: "x",
          references: [{ type: "accounts", id: "acc-1", reason: "first" }],
        },
        {
          id: "a1",
          role: "assistant",
          content: "b",
          createdAt: "y",
          references: [
            { type: "accounts", id: "acc-1", reason: "repeat" },
            { type: "orders", id: "ord-9", reason: "new" },
          ],
        },
      ];
      const { service, chatbot } = buildSut({ findReturns: { ...makePersistedConvo(priorMessages) } });
      await service.appendMessage({
        conversationId: "convo-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "more",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      // Each entity should appear exactly once
      expect((sys.content.match(/accounts\/acc-1/g) ?? []).length).toBe(1);
      expect((sys.content.match(/orders\/ord-9/g) ?? []).length).toBe(1);
      // First-seen reason wins
      expect(sys.content).toContain("accounts/acc-1: first");
    });

    it("trims history to at most MAX_MESSAGES_TO_LLM prior messages before the new user message", async () => {
      // Build 25 prior messages — trimmed should keep only the last 20.
      const priorMessages = Array.from({ length: 25 }, (_, i) => ({
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg-${i}`,
        createdAt: `2026-04-17T00:00:${String(i).padStart(2, "0")}Z`,
      }));
      const { service, chatbot } = buildSut({ findReturns: { ...makePersistedConvo(priorMessages) } });
      await service.appendMessage({
        conversationId: "convo-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "latest",
      });
      const passed = chatbot.run.mock.calls[0][0].messages;
      // No prior refs so no hydration system message; should be exactly 20 prior + 1 new = 21
      expect(passed.every((m: any) => m.role !== "system")).toBe(true);
      expect(passed).toHaveLength(MAX_MESSAGES_TO_LLM + 1);
      // The first trimmed prior should be m-5 (index 5 onwards = last 20 of 25)
      expect(passed[0].content).toBe("msg-5");
      expect(passed[passed.length - 1].content).toBe("latest");
    });

    it("persists the updated messages array via repository.patch", async () => {
      const { service, repo } = buildSut({ findReturns: { ...makePersistedConvo([]) } });
      await service.appendMessage({
        conversationId: "convo-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "hi",
      });
      expect(repo.patch).toHaveBeenCalledWith(expect.objectContaining({ id: "convo-1", messages: expect.any(String) }));
      const stored = JSON.parse(repo.patch.mock.calls[0][0].messages);
      expect(stored).toHaveLength(2);
      expect(stored[0].role).toBe("user");
      expect(stored[1].role).toBe("assistant");
    });

    it("returns the updated Conversation with hydrated messages and the turn's toolCalls", async () => {
      const { service } = buildSut({ findReturns: { ...makePersistedConvo([]) } });
      const result = await service.appendMessage({
        conversationId: "convo-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "hi",
      });
      expect(result.conversation.id).toBe("convo-1");
      // conversation.messages was hydrated from the stringified JSON — still an array on exit.
      expect(Array.isArray(result.conversation.messages)).toBe(true);
      expect(result.toolCalls).toEqual([{ tool: "search_entities", input: {}, durationMs: 1 }]);
    });
  });

  describe("hydrate helper", () => {
    it("parses stringified messages on read via the bespoke agent-turn flow", async () => {
      const msgs = [{ id: "u1", role: "user", content: "x", createdAt: "t" }];
      const { service } = buildSut({ findReturns: makePersistedConvo(msgs) });
      // appendMessage reads via loadHydrated → returns the typed Conversation with an array.
      const result = await service.appendMessage({
        conversationId: "convo-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "follow-up",
      });
      expect(Array.isArray(result.conversation.messages)).toBe(true);
    });

    it("handles an empty/absent messages field gracefully (defaults to [] on the typed result)", async () => {
      // The repo mock returns the same entity with `messages: ""` on every findById call; the
      // hydrate helper must turn that into an empty array rather than throwing. The repo is
      // patched with the new messages array, but the stub still reads back the empty string.
      const { service, chatbot } = buildSut({ findReturns: { ...makePersistedConvo(), messages: "" } });
      const result = await service.appendMessage({
        conversationId: "convo-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "hi",
      });
      // No prior messages → no hydration system message emitted to the chatbot.
      const passed = chatbot.run.mock.calls[0][0].messages;
      expect(passed.every((m: any) => m.role !== "system")).toBe(true);
      // Hydration of the "" string yields an array (not a thrown error).
      expect(Array.isArray(result.conversation.messages)).toBe(true);
    });
  });
});
