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
      conversation: makeConversation({
        messages: [
          { id: "u1", role: "user", content: "hi", createdAt: "2026-04-17T00:00:00Z" },
          {
            id: "a1",
            role: "assistant",
            content: "hey",
            createdAt: "2026-04-17T00:00:01Z",
            references: [],
            suggestedQuestions: [],
            tokens: { input: 1, output: 1 },
          },
        ],
      }),
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
      toolCalls: [{ tool: "search_entities", input: {}, durationMs: 5 }],
    })),
  };
  const jsonApi = {
    buildSingle: vi.fn(async (model: any, data: any) => ({
      data: { type: model.type, id: data.id, attributes: { ...data } },
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
      expect(conversations.createWithFirstMessage).toHaveBeenCalledWith(expect.objectContaining({ title: "My Chat" }));
    });

    it("builds the response via JsonApiService.buildSingle with ConversationDescriptor.model", async () => {
      await ctl.create(envelope([{ role: "user", content: "hi" }]) as any, REQ);
      expect(jsonApi.buildSingle).toHaveBeenCalledWith(
        ConversationDescriptor.model,
        expect.objectContaining({ id: "convo-1" }),
      );
    });
  });

  describe("POST /assistants/:conversationId/messages (append)", () => {
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

    it("returns the full updated Conversation via buildSingle with per-turn toolCalls in meta", async () => {
      const res: any = await ctl.append("convo-1", envelope("continue") as any, REQ);
      // Document was built through the descriptor-driven serialiser (no hand-assembled JSON:API).
      expect(jsonApi.buildSingle).toHaveBeenCalledWith(
        ConversationDescriptor.model,
        expect.objectContaining({ id: "convo-1" }),
      );
      expect(res.data).toMatchObject({ type: "assistants", id: "convo-1" });
      expect(res.meta).toEqual({ toolCalls: [{ tool: "search_entities", input: {}, durationMs: 5 }] });
    });
  });

  describe("standard CRUD routes delegate to createCrudHandlers", () => {
    it("GET /assistants passes list params through to crud.findAll", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      // Stub the underlying service.find since the crud handler uses it.
      (conversations as any).find = vi.fn(async () => ({ data: [] }));
      await ctl.findAll(reply, { foo: "bar" } as any, "search-term", true, "name");
      expect((conversations as any).find).toHaveBeenCalledWith({
        term: "search-term",
        query: { foo: "bar" },
        fetchAll: true,
        orderBy: "name",
      });
      expect(send).toHaveBeenCalled();
    });

    it("GET /assistants/:conversationId delegates to crud.findById", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      (conversations as any).findById = vi.fn(async () => ({ data: {} }));
      await ctl.findById(reply, "convo-1");
      expect((conversations as any).findById).toHaveBeenCalledWith({ id: "convo-1" });
      expect(send).toHaveBeenCalled();
    });

    it("PATCH /assistants/:conversationId delegates to crud.patch with the DTO envelope", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      (conversations as any).patchFromDTO = vi.fn(async () => ({ data: {} }));
      const body = {
        data: { type: "assistants", id: "convo-1", attributes: { title: "Renamed" } },
      } as any;
      await ctl.patch(reply, body);
      expect((conversations as any).patchFromDTO).toHaveBeenCalledWith({ data: body.data });
      expect(send).toHaveBeenCalled();
    });

    it("DELETE /assistants/:conversationId delegates to crud.delete", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      (conversations as any).delete = vi.fn(async () => undefined);
      await ctl.delete(reply, "convo-1");
      expect((conversations as any).delete).toHaveBeenCalledWith({ id: "convo-1" });
      expect(send).toHaveBeenCalled();
    });
  });
});
