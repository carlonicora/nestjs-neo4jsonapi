import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantController } from "../assistant.controller";
import { ConversationDescriptor } from "../../entities/conversation";

describe("AssistantController", () => {
  const makeConversation = (overrides: Partial<any> = {}) => ({
    id: "convo-1",
    type: "assistants",
    title: "Hello",
    messages: [],
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const conversations = {
    createWithFirstMessage: vi.fn(async () => makeConversation()),
    appendMessage: vi.fn(async () => ({
      conversation: makeConversation(),
      userMessage: { id: "u1", role: "user", content: "hi", createdAt: "2026-04-17T00:00:00Z" },
      assistantMessage: {
        id: "a1",
        role: "assistant",
        content: "hey",
        createdAt: "2026-04-17T00:00:01Z",
        references: [],
        suggestedQuestions: [],
        tokens: { input: 1, output: 1 },
      },
      toolCalls: [],
    })),
    findAll: vi.fn(async () => [makeConversation()]),
    findById: vi.fn(async () => makeConversation()),
    rename: vi.fn(async () => makeConversation({ title: "Renamed" })),
    remove: vi.fn(async () => undefined),
  };
  const jsonApi = {
    buildSingle: vi.fn(async (model: any, data: any) => ({
      data: { type: model.type, id: data.id, attributes: data },
    })),
    buildList: vi.fn(async (model: any, data: any[]) => ({
      data: data.map((d) => ({ type: model.type, id: d.id, attributes: d })),
    })),
  };

  const ctl = new AssistantController(conversations as any, jsonApi as any);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const REQ = { user: { userId: "u", companyId: "c", roles: ["role-1"] } } as any;

  describe("POST /assistants (create)", () => {
    const envelope = (messages: any[], title?: string) => ({
      data: {
        type: "assistants",
        attributes: { messages, ...(title !== undefined ? { title } : {}) },
      },
    });

    it("unwraps the envelope and delegates to ConversationService with the first message", async () => {
      await ctl.create(envelope([{ role: "user", content: "hello there" }]) as any, REQ);
      expect(conversations.createWithFirstMessage).toHaveBeenCalledWith({
        companyId: "c",
        userId: "u",
        roles: ["role-1"],
        firstMessage: "hello there",
        title: undefined,
      });
    });

    it("passes the optional title through", async () => {
      await ctl.create(envelope([{ role: "user", content: "hi" }], "My Chat") as any, REQ);
      expect(conversations.createWithFirstMessage).toHaveBeenCalledWith(
        expect.objectContaining({ title: "My Chat" }),
      );
    });

    it("builds the response via JsonApiService.buildSingle with ConversationDescriptor.model", async () => {
      await ctl.create(envelope([{ role: "user", content: "hi" }]) as any, REQ);
      expect(jsonApi.buildSingle).toHaveBeenCalledWith(ConversationDescriptor.model, expect.objectContaining({ id: "convo-1" }));
    });
  });

  describe("POST /assistants/:id/messages (append)", () => {
    const envelope = (content: string) => ({
      data: { type: "messages", attributes: { role: "user", content } },
    });

    it("delegates to ConversationService.appendMessage with the conversation id and new message", async () => {
      await ctl.append("convo-1", envelope("continue") as any, REQ);
      expect(conversations.appendMessage).toHaveBeenCalledWith({
        conversationId: "convo-1",
        companyId: "c",
        userId: "u",
        roles: ["role-1"],
        newMessage: "continue",
      });
    });

    it("emits a synthetic messages collection with user + assistant messages and meta.toolCalls", async () => {
      const res = await ctl.append("convo-1", envelope("continue") as any, REQ);
      expect(res.data).toHaveLength(2);
      expect(res.data[0]).toMatchObject({ type: "messages", id: "u1" });
      expect(res.data[1]).toMatchObject({ type: "messages", id: "a1" });
      expect(res.meta).toMatchObject({ conversationId: "convo-1", toolCalls: [] });
      // Must NOT go through buildSingle/buildList — messages are projections, not resources.
      expect(jsonApi.buildSingle).not.toHaveBeenCalled();
      expect(jsonApi.buildList).not.toHaveBeenCalled();
    });
  });

  describe("GET /assistants (list)", () => {
    it("calls ConversationService.findAll and builds the list via JsonApiService.buildList", async () => {
      await ctl.list();
      expect(conversations.findAll).toHaveBeenCalledOnce();
      expect(jsonApi.buildList).toHaveBeenCalledWith(ConversationDescriptor.model, expect.any(Array));
    });
  });

  describe("GET /assistants/:id (read)", () => {
    it("calls ConversationService.findById and builds a single response", async () => {
      await ctl.read("convo-1");
      expect(conversations.findById).toHaveBeenCalledWith({ conversationId: "convo-1" });
      expect(jsonApi.buildSingle).toHaveBeenCalledWith(ConversationDescriptor.model, expect.any(Object));
    });
  });

  describe("PATCH /assistants/:id (rename)", () => {
    const envelope = (title?: string) => ({
      data: { type: "assistants", id: "convo-1", attributes: { title } },
    });

    it("delegates a title change to ConversationService.rename", async () => {
      await ctl.rename("convo-1", envelope("New Title") as any);
      expect(conversations.rename).toHaveBeenCalledWith({ conversationId: "convo-1", title: "New Title" });
      expect(jsonApi.buildSingle).toHaveBeenCalledWith(ConversationDescriptor.model, expect.any(Object));
    });

    it("is a no-op rename when title is missing (returns current conversation)", async () => {
      await ctl.rename("convo-1", envelope(undefined) as any);
      expect(conversations.rename).not.toHaveBeenCalled();
      expect(conversations.findById).toHaveBeenCalledWith({ conversationId: "convo-1" });
    });
  });

  describe("DELETE /assistants/:id", () => {
    it("delegates to ConversationService.remove", async () => {
      await ctl.delete("convo-1");
      expect(conversations.remove).toHaveBeenCalledWith({ conversationId: "convo-1" });
    });
  });
});
