import { PATH_METADATA } from "@nestjs/common/constants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assistantActionMeta } from "../../../../foundations/assistant-action/entities/assistant-action.meta";
import { assistantMessageMeta } from "../../../../foundations/assistant-message/entities/assistant-message.meta";
import { assistantMeta } from "../../../../foundations/assistant/entities/assistant.meta";
import { operatorMeta } from "../../entities/operator.meta";
import { OperatorController } from "../operator.controller";

describe("OperatorController", () => {
  const makeAssistant = (overrides: Partial<any> = {}) => ({
    id: "asst-1",
    type: assistantMeta.type,
    title: "Thread",
    engine: "operator",
    company: { id: "c-1" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const makeMessage = (overrides: Partial<any> = {}) => ({
    id: "m-1",
    type: assistantMessageMeta.type,
    role: "user",
    content: "hello",
    position: 0,
    company: { id: "c-1" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const makeAction = (overrides: Partial<any> = {}) => ({
    id: "act-1",
    type: assistantActionMeta.type,
    status: "pending",
    toolName: "operator_test_action",
    toolArgs: "{}",
    summary: "Do the thing",
    threadId: "asst-1:m-1",
    userModuleIds: "[]",
    expiresAt: new Date().toISOString(),
    company: { id: "c-1" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const userMessage = makeMessage();
  const assistantMessage = makeMessage({ id: "m-2", role: "assistant", content: "hi there", position: 1 });

  // AssistantService is mocked: the operator turn orchestration lives there.
  const assistants: any = {
    createWithFirstMessageOperator: vi.fn(async () => ({
      assistant: makeAssistant(),
      userMessage,
      assistantMessage,
      toolCalls: [{ tool: "search_documents" }],
      action: undefined,
    })),
    appendMessageOperator: vi.fn(async () => ({
      userMessage,
      assistantMessage,
      toolCalls: [],
      action: undefined,
    })),
  };

  // buildSingle(Assistant) emits the primary resource plus slim traversal
  // copies of the messages in `included` (mirrors JsonApiService behaviour).
  const jsonApi: any = {
    buildSingle: vi.fn(async (model: any, data: any) => {
      if (model.type === assistantMeta.type) {
        return {
          data: { type: model.type, id: data.id, attributes: { title: data.title } },
          included: [
            { type: assistantMessageMeta.type, id: "m-1", attributes: { content: "slim" } },
            { type: assistantMessageMeta.type, id: "m-2", attributes: { content: "slim" } },
          ],
        };
      }
      return { data: { type: model.type, id: data.id, attributes: { ...data } } };
    }),
    // buildList emits rich message resources with an assistant back-pointer.
    buildList: vi.fn(async (model: any, items: any[]) => ({
      data: items.map((item) => ({
        type: model.type,
        id: item.id,
        attributes: { content: item.content },
        relationships: {
          assistant: { data: { type: assistantMeta.type, id: "asst-1" } },
        },
      })),
      included: [{ type: assistantMeta.type, id: "asst-1", attributes: { title: "echoed primary" } }],
    })),
  };

  const ctl = new OperatorController(assistants, jsonApi);

  const req = { user: { userId: "u-1", companyId: "c-1" } } as any;
  const postBody = (attributes: Record<string, any>) => ({ data: { type: assistantMeta.type, attributes } }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("route paths", () => {
    it("exposes POST /operator built from operatorMeta (no literal segments)", () => {
      expect(Reflect.getMetadata(PATH_METADATA, OperatorController.prototype.create)).toBe(operatorMeta.endpoint);
      expect(operatorMeta.endpoint).toBe("operator");
    });

    it("exposes POST /operator/:assistantId/assistant-messages from the metas", () => {
      expect(Reflect.getMetadata(PATH_METADATA, OperatorController.prototype.append)).toBe(
        `${operatorMeta.endpoint}/:assistantId/${assistantMessageMeta.endpoint}`,
      );
      expect(`${operatorMeta.endpoint}/:assistantId/${assistantMessageMeta.endpoint}`).toBe(
        "operator/:assistantId/assistant-messages",
      );
    });
  });

  describe("POST /operator", () => {
    it("calls AssistantService.createWithFirstMessageOperator with the authenticated user's scope", async () => {
      await ctl.create(postBody({ content: "hello", title: "Thread", howToMode: true, limitToHowToId: "h-1" }), req);

      expect(assistants.createWithFirstMessageOperator).toHaveBeenCalledWith({
        companyId: "c-1",
        userId: "u-1",
        firstMessage: "hello",
        title: "Thread",
        howToMode: true,
        limitToHowToId: "h-1",
      });
    });

    it("returns the Assistant document with rich messages merged into included and toolCalls in meta", async () => {
      const document = await ctl.create(postBody({ content: "hello" }), req);

      expect(document.data).toMatchObject({ type: assistantMeta.type, id: "asst-1" });
      expect(document.meta.toolCalls).toEqual([{ tool: "search_documents" }]);

      const included = document.included as any[];
      const keys = included.map((r) => `${r.type}-${r.id}`);
      // rich buildList copies override the slim traversal copies (dedupe by type-id)
      expect(keys).toHaveLength(new Set(keys).size);
      expect(included).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: assistantMessageMeta.type, id: "m-1", attributes: { content: "hello" } }),
          expect.objectContaining({ type: assistantMessageMeta.type, id: "m-2", attributes: { content: "hi there" } }),
        ]),
      );
      // primary assistant never echoed into included; back-pointers stripped
      expect(keys).not.toContain(`${assistantMeta.type}-asst-1`);
      for (const resource of included) {
        expect(resource.relationships?.assistant).toBeUndefined();
      }
    });

    it("includes the pending assistant-action when the run froze on approval", async () => {
      assistants.createWithFirstMessageOperator.mockResolvedValueOnce({
        assistant: makeAssistant(),
        userMessage,
        assistantMessage,
        toolCalls: [],
        action: makeAction(),
      });

      const document = await ctl.create(postBody({ content: "delete it all" }), req);

      expect(document.included).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: assistantActionMeta.type,
            id: "act-1",
            attributes: expect.objectContaining({ status: "pending" }),
          }),
        ]),
      );
    });
  });

  describe("POST /operator/:assistantId/assistant-messages", () => {
    it("calls AssistantService.appendMessageOperator with the route param and user scope", async () => {
      await ctl.append("asst-1", postBody({ content: "next", howToMode: false }), req);

      expect(assistants.appendMessageOperator).toHaveBeenCalledWith({
        assistantId: "asst-1",
        companyId: "c-1",
        userId: "u-1",
        newMessage: "next",
        howToMode: false,
        limitToHowToId: undefined,
      });
    });

    it("returns the two messages as a list document with toolCalls in meta", async () => {
      assistants.appendMessageOperator.mockResolvedValueOnce({
        userMessage,
        assistantMessage,
        toolCalls: [{ tool: "search_communities" }],
        action: undefined,
      });

      const document = await ctl.append("asst-1", postBody({ content: "next" }), req);

      expect(document.data).toHaveLength(2);
      expect(document.data[0]).toMatchObject({ type: assistantMessageMeta.type, id: "m-1" });
      expect(document.data[1]).toMatchObject({ type: assistantMessageMeta.type, id: "m-2" });
      expect(document.meta.toolCalls).toEqual([{ tool: "search_communities" }]);
      // no pending action -> included keeps buildList output untouched
      expect(jsonApi.buildSingle).not.toHaveBeenCalled();
    });

    it("merges the pending assistant-action into included, stripping the assistant echo", async () => {
      assistants.appendMessageOperator.mockResolvedValueOnce({
        userMessage,
        assistantMessage,
        toolCalls: [],
        action: makeAction({ id: "act-2" }),
      });

      const document = await ctl.append("asst-1", postBody({ content: "next" }), req);

      const included = document.included as any[];
      expect(included).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: assistantActionMeta.type, id: "act-2" })]),
      );
      // the assistant echoed by buildList's included must be stripped
      expect(included.map((r) => `${r.type}-${r.id}`)).not.toContain(`${assistantMeta.type}-asst-1`);
    });

    it("propagates errors from appendMessageOperator", async () => {
      assistants.appendMessageOperator.mockRejectedValueOnce(new Error("Not Found"));
      await expect(ctl.append("missing", postBody({ content: "next" }), req)).rejects.toThrow("Not Found");
    });
  });
});
