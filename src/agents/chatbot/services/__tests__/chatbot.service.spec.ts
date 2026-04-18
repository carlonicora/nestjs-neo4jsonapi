import { vi } from "vitest";
import { ChatbotService } from "../chatbot.service";

describe("ChatbotService", () => {
  const llmResponse = {
    answer: "The last order is #O1 for 100 EUR.",
    references: [{ type: "orders", id: "o1", reason: "Most recent order for Acme Corp" }],
    needsClarification: false,
    suggestedQuestions: ["What was the previous order?"],
  };
  const llmService: any = {
    call: vi.fn(async () => ({ ...llmResponse, tokenUsage: { input: 500, output: 100 } })),
  };
  const graphCatalog: any = {
    getMapFor: vi.fn((m: string[]) => (m.length ? `## Entities\n- accounts\n` : "")),
  };
  const factory: any = {};
  const tools = {
    describeEntity: { build: () => ({ name: "describe_entity" }) },
    searchEntities: { build: () => ({ name: "search_entities" }) },
    readEntity: { build: () => ({ name: "read_entity" }) },
    traverse: { build: () => ({ name: "traverse" }) },
  };
  const svc = new ChatbotService(
    llmService,
    graphCatalog,
    factory,
    tools.describeEntity as any,
    tools.searchEntities as any,
    tools.readEntity as any,
    tools.traverse as any,
  );

  beforeEach(() => {
    llmService.call.mockClear();
    graphCatalog.getMapFor.mockClear();
  });

  it("assembles system prompt with graph map and invokes LLM", async () => {
    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["crm"],
      messages: [{ role: "user", content: "What is the last order from Acme?" }],
    });
    expect(graphCatalog.getMapFor).toHaveBeenCalledWith(["crm"]);
    expect(llmService.call).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompts: expect.arrayContaining([expect.stringContaining("accounts")]),
        tools: expect.arrayContaining([{ name: "describe_entity" }]),
        maxToolIterations: 10,
        temperature: 0.1,
      }),
    );
    expect(out.answer).toBe("The last order is #O1 for 100 EUR.");
    expect(out.references).toHaveLength(1);
    expect(out.needsClarification).toBe(false);
    expect(out.tokens).toEqual({ input: 500, output: 100 });
  });

  it("returns clean refusal when userModules is empty", async () => {
    const out = await svc.run({
      companyId: "c1",
      userId: "u1",
      userModules: [],
      messages: [{ role: "user", content: "anything" }],
    });
    expect(out.answer).toMatch(/no accessible data|no enabled modules/i);
    expect(llmService.call).not.toHaveBeenCalled();
  });
});
