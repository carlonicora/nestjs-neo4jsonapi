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
      findReferencedTypeIdPairs: vi.fn(async () => []),
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

    const graphCatalog = {
      getEntityDetail: vi.fn((type: string) => ({
        type,
        module: "crm",
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
      chatbot,
      assistantMessages,
      assistantMessageRepo,
      graphCatalog,
      entityServices,
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
      graphCatalog,
      entityServices,
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
        }),
      ];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" },
      ]);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: "Focus Account" })),
      });
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
      // focus section renders a full JSON record tagged with type and id
      expect(sys.content).toContain('"type": "accounts"');
      expect(sys.content).toContain('"id": "acc-1"');
    });

    it("deduplicates references across multiple prior turns", async () => {
      const priorMessages = [
        makePersistedMessage({
          id: "a0",
          role: "assistant",
          content: "a",
          position: 0,
        }),
        makePersistedMessage({
          id: "a1",
          role: "assistant",
          content: "b",
          position: 1,
        }),
      ];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" },
        { messageId: "a1", type: "accounts", id: "acc-1" },
        { messageId: "a1", type: "orders", id: "ord-9" },
      ]);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: `n-${id}` })),
      });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "more",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      // each entity appears exactly once in the focus JSON block
      expect((sys.content.match(/"id": "acc-1"/g) ?? []).length).toBe(1);
      expect((sys.content.match(/"id": "ord-9"/g) ?? []).length).toBe(1);
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

    it("hydration: previous assistant message references are rendered as full records (focus)", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "u0", role: "user", content: "first", position: 0 }),
        makePersistedMessage({ id: "a0", role: "assistant", content: "answer", position: 1 }),
      ];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" },
      ]);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: "Faby and Carlo" })),
      });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "are there other orders?",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      expect(sys).toBeDefined();
      expect(sys.content).toContain("Full records from the previous answer");
      expect(sys.content).toContain('"type": "accounts"');
      expect(sys.content).toContain('"id": "acc-1"');
      expect(sys.content).toContain('"name": "Faby and Carlo"');
      // no background section when no older refs exist
      expect(sys.content).not.toContain("Other entities mentioned earlier");
    });

    it("hydration: focus directive points at resolve_entity, not search_entities", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "u0", role: "user", content: "first", position: 0 }),
        makePersistedMessage({ id: "a0", role: "assistant", content: "answer", position: 1 }),
      ];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" },
      ]);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: "Faby and Carlo" })),
      });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "are there other orders?",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      expect(sys).toBeDefined();
      expect(sys.content).toMatch(/Do not call resolve_entity for a name/);
      expect(sys.content).not.toMatch(/Do not call search_entities for a name/);
    });

    it("hydration: older-turn references are rendered as Type/id - name stubs (background)", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "a0", role: "assistant", content: "old", position: 1 }),
        makePersistedMessage({ id: "u1", role: "user", content: "follow-up q", position: 2 }),
        makePersistedMessage({ id: "a1", role: "assistant", content: "newer", position: 3 }),
      ];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" }, // older turn → background
        { messageId: "a1", type: "orders", id: "ord-9" }, // most recent assistant → focus
      ]);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => {
          if (id === "acc-1") return { id, name: "Older Account" };
          if (id === "ord-9") return { id, name: "Recent Order" };
          return null;
        }),
      });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "next",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      expect(sys.content).toContain("Full records from the previous answer");
      expect(sys.content).toContain('"type": "orders"');
      expect(sys.content).toContain('"id": "ord-9"');
      expect(sys.content).toContain("Other entities mentioned earlier");
      expect(sys.content).toMatch(/- accounts\/acc-1 — "Older Account"/);
    });

    it("hydration: entity in both previous and older turns is rendered as focus only", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "a0", role: "assistant", content: "a", position: 1 }),
        makePersistedMessage({ id: "a1", role: "assistant", content: "b", position: 3 }),
      ];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" },
        { messageId: "a1", type: "accounts", id: "acc-1" }, // same entity, most recent
      ]);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: "Dup" })),
      });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "q",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      // focus section contains the record once
      expect((sys.content.match(/"id": "acc-1"/g) ?? []).length).toBe(1);
      // no background section — the only reference is already focus
      expect(sys.content).not.toContain("Other entities mentioned earlier");
    });

    it("hydration: entity whose findRecordById throws is dropped silently", async () => {
      const priorMessages = [makePersistedMessage({ id: "a0", role: "assistant", content: "x", position: 1 })];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-deleted" },
        { messageId: "a0", type: "accounts", id: "acc-ok" },
      ]);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => {
          if (id === "acc-deleted") throw new Error("not found");
          return { id, name: "Present" };
        }),
      });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "q",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      expect(sys.content).toContain('"id": "acc-ok"');
      expect(sys.content).not.toContain("acc-deleted");
    });

    it("hydration: entity whose type is not in userModules is dropped", async () => {
      const priorMessages = [makePersistedMessage({ id: "a0", role: "assistant", content: "x", position: 1 })];
      const { service, chatbot, assistantMessageRepo, graphCatalog } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" },
        { messageId: "a0", type: "forbidden", id: "fb-1" },
      ]);
      (graphCatalog.getEntityDetail as any).mockImplementation((type: string) =>
        type === "forbidden" ? null : { type, module: "crm", textSearchFields: ["name"] },
      );
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "q",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      expect(sys.content).toContain('"id": "acc-1"');
      expect(sys.content).not.toContain("fb-1");
    });

    it("hydration: focus set is capped at 25 records with a warning", async () => {
      const priorMessages = [makePersistedMessage({ id: "a0", role: "assistant", content: "x", position: 1 })];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      const pairs = Array.from({ length: 30 }, (_, i) => ({
        messageId: "a0",
        type: "accounts",
        id: `acc-${i}`,
      }));
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue(pairs);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: `n-${id}` })),
      });
      const warnSpy = vi.spyOn((service as any).assistantLogger, "warn").mockImplementation(() => {});
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "q",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      const matches = sys.content.match(/"id": "acc-\d+"/g) ?? [];
      expect(matches.length).toBe(25);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/focus set capped at 25/));
    });

    it("hydration: if findReferencedTypeIdPairs throws, chat turn proceeds with no system message", async () => {
      const priorMessages = [makePersistedMessage({ id: "a0", role: "assistant", content: "x", position: 1 })];
      const { service, chatbot, assistantMessageRepo } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockRejectedValue(new Error("neo4j down"));
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "q",
      });
      const passed = chatbot.run.mock.calls[0][0].messages;
      expect(passed.every((m: any) => m.role !== "system")).toBe(true);
    });

    it("hydration: background stubs without textSearchFields render without a label", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "a0", role: "assistant", content: "a", position: 1 }),
        makePersistedMessage({ id: "a1", role: "assistant", content: "b", position: 3 }),
      ];
      const { service, chatbot, assistantMessageRepo, graphCatalog, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "nolabel", id: "nl-1" }, // background
        { messageId: "a1", type: "accounts", id: "acc-1" }, // focus
      ]);
      (graphCatalog.getEntityDetail as any).mockImplementation((type: string) => ({
        type,
        module: "crm",
        textSearchFields: type === "nolabel" ? undefined : ["name"],
      }));
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: "some name" })),
      });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "q",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      // no quoted label for nolabel
      expect(sys.content).toContain("- nolabel/nl-1");
      expect(sys.content).not.toMatch(/- nolabel\/nl-1 — "/);
    });

    it("buildHydrationMessage splits references into focus (previous answer) and background (older)", async () => {
      const priorMessages = [
        makePersistedMessage({ id: "a0", role: "assistant", content: "x", position: 1 }),
        makePersistedMessage({ id: "a1", role: "assistant", content: "y", position: 3 }),
      ];
      const { service, chatbot, assistantMessageRepo, entityServices } = buildSut({ priorMessages });
      (assistantMessageRepo.findReferencedTypeIdPairs as any).mockResolvedValue([
        { messageId: "a0", type: "accounts", id: "acc-1" },
        { messageId: "a1", type: "orders", id: "ord-1" },
      ]);
      (entityServices.get as any).mockReturnValue({
        findRecordById: vi.fn(async ({ id }: any) => ({ id, name: `n-${id}` })),
      });
      await service.appendMessage({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["r"],
        newMessage: "follow-up",
      });
      const sys = chatbot.run.mock.calls[0][0].messages.find((m: any) => m.role === "system");
      // ord-1 is focus → appears as a full JSON record
      expect(sys.content).toContain('"type": "orders"');
      expect(sys.content).toContain('"id": "ord-1"');
      // acc-1 is background → appears as a bullet stub with label
      expect(sys.content).toMatch(/- accounts\/acc-1 — "n-acc-1"/);
    });
  });
});
