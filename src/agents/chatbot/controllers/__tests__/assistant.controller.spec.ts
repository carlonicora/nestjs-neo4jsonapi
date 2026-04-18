import { vi } from "vitest";
import { AssistantController } from "../assistant.controller";
import { AssistantDescriptor } from "../../entities/assistant";

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
  const jsonApi = {
    buildSingle: vi.fn(async (model: any, data: any) => ({
      data: { type: model.type, id: data.id, attributes: data },
    })),
  };
  const ctl = new AssistantController(chatbot as any, userModules as any, jsonApi as any);

  const envelope = (messages: any[]) => ({
    data: { type: "assistants", attributes: { messages } },
  });

  beforeEach(() => {
    chatbot.run.mockClear();
    userModules.findModulesForRoles.mockClear();
    jsonApi.buildSingle.mockClear();
  });

  it("unwraps the JSON:API envelope and passes messages to the chatbot", async () => {
    await ctl.post(
      envelope([{ role: "user", content: "hi" }]) as any,
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

  it("builds the response via JsonApiService.buildSingle with AssistantDescriptor.model", async () => {
    const result = await ctl.post(
      envelope([{ role: "user", content: "hi" }]) as any,
      { user: { userId: "u", companyId: "c", roles: ["role-1"] } } as any,
    );
    expect(jsonApi.buildSingle).toHaveBeenCalledWith(
      AssistantDescriptor.model,
      expect.objectContaining({
        answer: "ok",
        needsClarification: false,
        suggestedQuestions: [],
        references: [],
        tokens: { input: 1, output: 2 },
        toolCalls: [],
      }),
    );
    const [, passedData] = jsonApi.buildSingle.mock.calls[0];
    expect(typeof passedData.id).toBe("string");
    expect(passedData.id.length).toBeGreaterThan(0);
    expect(result.data.type).toBe(AssistantDescriptor.model.type);
  });

  it("handles users with no roles gracefully", async () => {
    await ctl.post(
      envelope([{ role: "user", content: "hi" }]) as any,
      { user: { userId: "u", companyId: "c", roles: [] } } as any,
    );
    expect(userModules.findModulesForRoles).toHaveBeenCalledWith([]);
    expect(chatbot.run).toHaveBeenCalledWith(expect.objectContaining({ userModules: [] }));
  });
});
