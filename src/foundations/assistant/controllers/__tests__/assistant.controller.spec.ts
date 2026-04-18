import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantController } from "../assistant.controller";
import { AssistantDescriptor } from "../../entities/assistant";

describe("AssistantController", () => {
  const makeAssistant = (overrides: Partial<any> = {}) => ({
    id: "asst-1",
    type: "assistants",
    title: "Hello",
    messages: [],
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const assistants = {
    createWithFirstMessage: vi.fn(async () => ({
      assistant: makeAssistant(),
      toolCalls: [{ tool: "search_entities", input: {}, durationMs: 3 }],
    })),
    appendMessage: vi.fn(async () => ({
      assistant: makeAssistant({
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

  const ctl = new AssistantController(assistants as any, jsonApi as any);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const REQ = { user: { userId: "u", companyId: "c", roles: ["role-1"] } } as any;

  describe("POST /assistants (create)", () => {
    const envelope = (content: string, title?: string) => ({
      data: {
        type: "assistants",
        attributes: { content, ...(title !== undefined ? { title } : {}) },
      },
    });

    it("unwraps the envelope and delegates to AssistantService with the first message", async () => {
      await ctl.create(envelope("hello there") as any, REQ);
      expect(assistants.createWithFirstMessage).toHaveBeenCalledWith({
        companyId: "c",
        userId: "u",
        roles: ["role-1"],
        firstMessage: "hello there",
        title: undefined,
      });
    });

    it("passes the optional title through", async () => {
      await ctl.create(envelope("hi", "My Chat") as any, REQ);
      expect(assistants.createWithFirstMessage).toHaveBeenCalledWith(expect.objectContaining({ title: "My Chat" }));
    });

    it("builds the response via JsonApiService.buildSingle with AssistantDescriptor.model", async () => {
      await ctl.create(envelope("hi") as any, REQ);
      expect(jsonApi.buildSingle).toHaveBeenCalledWith(
        AssistantDescriptor.model,
        expect.objectContaining({ id: "asst-1" }),
      );
    });

    it("includes meta.toolCalls from the first agent turn in the create response", async () => {
      const res: any = await ctl.create(envelope("hi") as any, REQ);
      expect(res.meta).toEqual({ toolCalls: [{ tool: "search_entities", input: {}, durationMs: 3 }] });
    });
  });

  describe("POST /assistants/:assistantId/messages (append)", () => {
    const envelope = (content: string) => ({
      data: { type: "messages", attributes: { content } },
    });

    it("delegates to AssistantService.appendMessage with the assistant id and new message", async () => {
      await ctl.append("asst-1", envelope("continue") as any, REQ);
      expect(assistants.appendMessage).toHaveBeenCalledWith({
        assistantId: "asst-1",
        companyId: "c",
        userId: "u",
        roles: ["role-1"],
        newMessage: "continue",
      });
    });

    it("returns the full updated Assistant via buildSingle with per-turn toolCalls in meta", async () => {
      const res: any = await ctl.append("asst-1", envelope("continue") as any, REQ);
      expect(jsonApi.buildSingle).toHaveBeenCalledWith(
        AssistantDescriptor.model,
        expect.objectContaining({ id: "asst-1" }),
      );
      expect(res.data).toMatchObject({ type: "assistants", id: "asst-1" });
      expect(res.meta).toEqual({ toolCalls: [{ tool: "search_entities", input: {}, durationMs: 5 }] });
    });
  });

  describe("standard CRUD routes delegate to createCrudHandlers", () => {
    it("GET /assistants passes list params through to crud.findAll", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      (assistants as any).find = vi.fn(async () => ({ data: [] }));
      await ctl.findAll(reply, { foo: "bar" } as any, "search-term", true, "name");
      expect((assistants as any).find).toHaveBeenCalledWith({
        term: "search-term",
        query: { foo: "bar" },
        fetchAll: true,
        orderBy: "name",
      });
      expect(send).toHaveBeenCalled();
    });

    it("GET /assistants/:assistantId delegates to crud.findById", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      (assistants as any).findById = vi.fn(async () => ({ data: {} }));
      await ctl.findById(reply, "asst-1");
      expect((assistants as any).findById).toHaveBeenCalledWith({ id: "asst-1" });
      expect(send).toHaveBeenCalled();
    });

    it("PATCH /assistants/:assistantId delegates to crud.patch with the DTO envelope", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      (assistants as any).patchFromDTO = vi.fn(async () => ({ data: {} }));
      const body = {
        data: { type: "assistants", id: "asst-1", attributes: { title: "Renamed" } },
      } as any;
      await ctl.patch(reply, body);
      expect((assistants as any).patchFromDTO).toHaveBeenCalledWith({ data: body.data });
      expect(send).toHaveBeenCalled();
    });

    it("DELETE /assistants/:assistantId delegates to crud.delete", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      (assistants as any).delete = vi.fn(async () => undefined);
      await ctl.delete(reply, "asst-1");
      expect((assistants as any).delete).toHaveBeenCalledWith({ id: "asst-1" });
      expect(send).toHaveBeenCalled();
    });
  });
});
