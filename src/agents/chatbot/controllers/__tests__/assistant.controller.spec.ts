import { vi } from "vitest";
import { AssistantController } from "../assistant.controller";

describe("AssistantController", () => {
  const chatbot = {
    run: vi.fn(async () => ({
      type: "assistant",
      answer: "ok",
      references: [],
      needsClarification: false,
      suggestedQuestions: [],
      tokens: { input: 1, output: 2 },
      toolCalls: [],
    })),
  };
  const userModules = {
    findModulesForRoles: vi.fn(async (roles: string[]) => (roles.length ? ["crm"] : [])),
  };
  const ctl = new AssistantController(chatbot as any, userModules as any);

  beforeEach(() => {
    chatbot.run.mockClear();
    userModules.findModulesForRoles.mockClear();
  });

  it("resolves user modules from roles and passes them to the chatbot", async () => {
    await ctl.post(
      { messages: [{ role: "user", content: "hi" }] } as any,
      { user: { userId: "u", companyId: "c", roles: ["role-1"] } } as any,
    );
    expect(userModules.findModulesForRoles).toHaveBeenCalledWith(["role-1"]);
    expect(chatbot.run).toHaveBeenCalledWith({
      companyId: "c",
      userId: "u",
      userModules: ["crm"],
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("wraps the response as a JSON:API assistant-messages document", async () => {
    const result = await ctl.post(
      { messages: [{ role: "user", content: "hi" }] } as any,
      { user: { userId: "u", companyId: "c", roles: ["role-1"] } } as any,
    );
    expect(result.data.type).toBe("assistant-messages");
    expect(result.data.attributes.answer).toBe("ok");
    expect(result.data.meta.toolCalls).toEqual([]);
  });

  it("handles users with no roles gracefully", async () => {
    await ctl.post(
      { messages: [{ role: "user", content: "hi" }] } as any,
      { user: { userId: "u", companyId: "c", roles: [] } } as any,
    );
    expect(userModules.findModulesForRoles).toHaveBeenCalledWith([]);
    expect(chatbot.run).toHaveBeenCalledWith(expect.objectContaining({ userModules: [] }));
  });
});
