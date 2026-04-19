import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantController } from "../assistant.controller";
import { AssistantDescriptor } from "../../entities/assistant";
import { AssistantMessageDescriptor } from "../../../assistant-message/entities/assistant-message";

describe("AssistantController", () => {
  const makeAssistant = (overrides: Partial<any> = {}) => ({
    id: "asst-1",
    type: "assistants",
    title: "Hello",
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const makeMessage = (overrides: Partial<any> = {}) => ({
    id: "m-1",
    type: "assistant-messages",
    role: "user",
    content: "hi",
    position: 0,
    company: { id: "c" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const assistants = {
    createWithFirstMessage: vi.fn(async () => ({
      assistant: makeAssistant(),
      userMessage: makeMessage({ id: "u1", role: "user", position: 0 }),
      assistantMessage: makeMessage({ id: "a1", role: "assistant", position: 1 }),
      toolCalls: [{ tool: "search_entities", input: {}, durationMs: 3 }],
    })),
    appendMessage: vi.fn(async () => ({
      userMessage: makeMessage({ id: "u2", role: "user", position: 2, content: "continue" }),
      assistantMessage: makeMessage({ id: "a2", role: "assistant", position: 3, content: "hey" }),
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

    it("builds the Assistant response via JsonApiService.buildSingle and includes the two new messages", async () => {
      const res: any = await ctl.create(envelope("hi") as any, REQ);
      expect(jsonApi.buildSingle).toHaveBeenCalledWith(
        AssistantDescriptor.model,
        expect.objectContaining({ id: "asst-1" }),
      );
      expect(jsonApi.buildList).toHaveBeenCalledWith(
        AssistantMessageDescriptor.model,
        expect.arrayContaining([
          expect.objectContaining({ id: "u1" }),
          expect.objectContaining({ id: "a1" }),
        ]),
      );
      expect(res.included).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1" }),
          expect.objectContaining({ id: "a1" }),
        ]),
      );
    });

    it("includes meta.toolCalls from the first agent turn in the create response", async () => {
      const res: any = await ctl.create(envelope("hi") as any, REQ);
      expect(res.meta).toEqual({ toolCalls: [{ tool: "search_entities", input: {}, durationMs: 3 }] });
    });
  });

  describe("POST /assistants/:assistantId/assistant-messages (append)", () => {
    const envelope = (content: string) => ({
      data: { type: "assistant-messages", attributes: { content } },
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

    it("returns the two new messages via buildList with per-turn toolCalls in meta", async () => {
      const res: any = await ctl.append("asst-1", envelope("continue") as any, REQ);
      expect(jsonApi.buildList).toHaveBeenCalledWith(
        AssistantMessageDescriptor.model,
        expect.arrayContaining([
          expect.objectContaining({ id: "u2" }),
          expect.objectContaining({ id: "a2" }),
        ]),
      );
      expect(res.data).toHaveLength(2);
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
