import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantActionController } from "../controllers/assistant-action.controller";
import { assistantActionMeta } from "../entities/assistant-action.meta";
import { AssistantMessageDescriptor } from "../../assistant-message/entities/assistant-message";

describe("AssistantActionController", () => {
  const makeAction = (overrides: Partial<any> = {}) => ({
    id: "act-1",
    type: assistantActionMeta.type,
    status: "approved",
    toolName: "operator_test_action",
    toolArgs: "{}",
    summary: "Do the thing",
    threadId: "asst-1:msg-1",
    userModuleIds: "[]",
    expiresAt: new Date().toISOString(),
    company: { id: "c-1" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const makeMessage = (overrides: Partial<any> = {}) => ({
    id: "m-9",
    type: "assistant-messages",
    role: "assistant",
    content: "done",
    position: 4,
    company: { id: "c-1" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // AssistantService is mocked: resolveAction is contract C9 (implemented by Task 6).
  const assistants: any = {
    resolveAction: vi.fn(async () => ({
      assistantMessage: makeMessage(),
      action: makeAction(),
    })),
  };
  const assistantActions: any = {};
  const jsonApi: any = {
    buildSingle: vi.fn(async (model: any, data: any) => ({
      data: { type: model.type, id: data.id, attributes: { ...data } },
    })),
  };
  // Injected so the @Audit / @CacheInvalidate decorators (which read
  // this.auditService / this.cacheService) are active at runtime.
  const auditService: any = { logRead: vi.fn() };
  const cacheService: any = {
    invalidateByElement: vi.fn(async () => undefined),
    invalidateByType: vi.fn(async () => undefined),
  };

  const ctl = new AssistantActionController(assistantActions, assistants, jsonApi, auditService, cacheService);

  // The decorators locate the entity id via the request's route params.
  const makeRequest = (actionId = "act-1") => ({ params: { actionId } }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /assistant-actions/:actionId", () => {
    it("delegates to crud.findById which calls AssistantActionService.findById", async () => {
      const send = vi.fn();
      const reply = { send } as any;
      assistantActions.findById = vi.fn(async () => ({ data: {} }));

      await ctl.findById(makeRequest(), reply, "act-1");

      expect(assistantActions.findById).toHaveBeenCalledWith({ id: "act-1" });
      expect(send).toHaveBeenCalled();
    });

    it("audits the read via @Audit with the entity label and the actionId route param", async () => {
      const reply = { send: vi.fn() } as any;
      assistantActions.findById = vi.fn(async () => ({ data: {} }));

      await ctl.findById(makeRequest("act-1"), reply, "act-1");

      expect(auditService.logRead).toHaveBeenCalledWith({
        entityType: assistantActionMeta.labelName,
        entityId: "act-1",
      });
    });
  });

  describe("POST /assistant-actions/:actionId/approve", () => {
    it("calls AssistantService.resolveAction with approved: true", async () => {
      const send = vi.fn();
      await ctl.approve(makeRequest(), { send } as any, "act-1");
      expect(assistants.resolveAction).toHaveBeenCalledWith({ actionId: "act-1", approved: true });
    });

    it("invalidates the cached assistant-action via @CacheInvalidate after approving", async () => {
      const send = vi.fn();
      await ctl.approve(makeRequest("act-1"), { send } as any, "act-1");
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith(assistantActionMeta.endpoint, "act-1");
    });

    it("returns the final assistant message as the primary resource with the action included", async () => {
      const send = vi.fn();
      await ctl.approve(makeRequest(), { send } as any, "act-1");

      expect(jsonApi.buildSingle).toHaveBeenCalledWith(
        AssistantMessageDescriptor.model,
        expect.objectContaining({ id: "m-9" }),
      );

      const document = send.mock.calls[0][0];
      expect(document.data).toMatchObject({ type: "assistant-messages", id: "m-9" });
      expect(document.included).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: assistantActionMeta.type, id: "act-1" })]),
      );
    });

    it("dedupes included by (type,id) and never echoes the primary message into included", async () => {
      jsonApi.buildSingle.mockImplementationOnce(async (model: any, data: any) => ({
        data: { type: model.type, id: data.id, attributes: { ...data } },
        included: [
          { type: assistantActionMeta.type, id: "act-1", attributes: { status: "approved" } },
          { type: "assistant-messages", id: "m-9", attributes: { content: "echoed primary" } },
        ],
      }));

      const send = vi.fn();
      await ctl.approve(makeRequest(), { send } as any, "act-1");

      const document = send.mock.calls[0][0];
      const keys = (document.included as any[]).map((r) => `${r.type}-${r.id}`);
      expect(keys).toHaveLength(new Set(keys).size);
      expect(keys).toContain(`${assistantActionMeta.type}-act-1`);
      expect(keys).not.toContain("assistant-messages-m-9");
    });

    it("propagates errors from resolveAction (e.g. 409 on a lost race)", async () => {
      assistants.resolveAction.mockRejectedValueOnce(new Error("Conflict"));
      const send = vi.fn();
      await expect(ctl.approve(makeRequest(), { send } as any, "act-1")).rejects.toThrow("Conflict");
      expect(send).not.toHaveBeenCalled();
      // a failed resolve must not evict the (still pending) cached action
      expect(cacheService.invalidateByElement).not.toHaveBeenCalled();
    });
  });

  describe("POST /assistant-actions/:actionId/deny", () => {
    it("calls AssistantService.resolveAction with approved: false", async () => {
      const send = vi.fn();
      await ctl.deny(makeRequest(), { send } as any, "act-1");
      expect(assistants.resolveAction).toHaveBeenCalledWith({ actionId: "act-1", approved: false });
    });

    it("invalidates the cached assistant-action via @CacheInvalidate after denying", async () => {
      const send = vi.fn();
      await ctl.deny(makeRequest("act-1"), { send } as any, "act-1");
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith(assistantActionMeta.endpoint, "act-1");
    });

    it("returns the wrap-up assistant message with the denied action included", async () => {
      assistants.resolveAction.mockResolvedValueOnce({
        assistantMessage: makeMessage({ id: "m-10", content: "ok, not doing it" }),
        action: makeAction({ status: "denied" }),
      });

      const send = vi.fn();
      await ctl.deny(makeRequest(), { send } as any, "act-1");

      const document = send.mock.calls[0][0];
      expect(document.data).toMatchObject({ type: "assistant-messages", id: "m-10" });
      expect(document.included).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: assistantActionMeta.type,
            id: "act-1",
            attributes: expect.objectContaining({ status: "denied" }),
          }),
        ]),
      );
    });
  });
});
