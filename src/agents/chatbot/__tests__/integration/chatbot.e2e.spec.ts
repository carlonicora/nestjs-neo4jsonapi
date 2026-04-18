import { vi } from "vitest";
import { ChatbotService } from "../../services/chatbot.service";
import { GraphDescriptorRegistry } from "../../services/descriptor.source";
import { GraphCatalogService } from "../../services/graph.catalog.service";
import { ToolFactory } from "../../tools/tool.factory";
import { DescribeEntityTool } from "../../tools/describe-entity.tool";
import { SearchEntitiesTool } from "../../tools/search-entities.tool";
import { ReadEntityTool } from "../../tools/read-entity.tool";
import { TraverseTool } from "../../tools/traverse.tool";
import { LLMService } from "../../../../core/llm/services/llm.service";

function makeFakeServiceRegistry() {
  const services = new Map<string, any>();
  services.set("accounts", {
    model: { type: "accounts" },
    findRecords: vi.fn(async ({ filters }: any) => {
      const name = filters?.find((f: any) => f.field === "name")?.value ?? "";
      if (String(name).toLowerCase() === "acme") return [{ id: "acc-1", name: "Acme Corp" }];
      return [];
    }),
    findRecordById: vi.fn(async ({ id }: any) => (id === "acc-1" ? { id: "acc-1", name: "Acme Corp" } : null)),
  });
  services.set("orders", {
    model: { type: "orders" },
    findRecords: vi.fn(async () => []),
    findRelatedRecords: vi.fn(async () => [{ id: "ord-1", total: 1000, createdAt: "2026-04-01" }]),
  });
  return {
    get: (t: string) => services.get(t),
    listTypes: () => Array.from(services.keys()),
  } as any;
}

function accountDescriptor() {
  return {
    model: { type: "accounts", nodeName: "account", labelName: "Account" },
    description: "A company or supplier.",
    fields: { name: { type: "string", description: "Display name." } },
    relationships: {
      orders: {
        model: { type: "orders", nodeName: "order", labelName: "Order" },
        direction: "out",
        relationship: "PLACED",
        cardinality: "many",
        description: "Sales orders placed by this account.",
      },
    },
    chat: { summary: (d: any) => d.name, textSearchFields: ["name"] },
  };
}

function orderDescriptor() {
  return {
    model: { type: "orders", nodeName: "order", labelName: "Order" },
    description: "A sales order.",
    fields: {
      total: { type: "number", description: "Total value." },
      createdAt: { type: "datetime", description: "Creation timestamp." },
    },
    relationships: {},
    chat: { summary: (d: any) => `#${d.id}` },
  };
}

describe("Chatbot end-to-end (mocked LLM)", () => {
  let chatbot: ChatbotService;
  let scriptedToolCalls: Array<{ name: string; args: any }>;

  beforeAll(() => {
    const registry = new GraphDescriptorRegistry();
    registry.register({ descriptor: accountDescriptor(), module: "accounts" });
    registry.register({ descriptor: orderDescriptor(), module: "orders" });
    const catalog = new GraphCatalogService(registry);
    catalog.buildCatalog();
    const serviceRegistry = makeFakeServiceRegistry();

    scriptedToolCalls = [];
    const mockLLM = {
      call: vi.fn(async ({ tools }: any) => {
        // Simulate a 2-step tool-call: search for Acme, then traverse to last order.
        const search = tools.find((t: any) => t.name === "search_entities");
        const traverse = tools.find((t: any) => t.name === "traverse");
        const searchResult = JSON.parse(await search.func({ type: "accounts", text: "acme" }));
        scriptedToolCalls.push({
          name: "search_entities",
          args: { type: "accounts", text: "acme" },
        });
        const traverseResult = JSON.parse(
          await traverse.func({
            fromType: "accounts",
            fromId: searchResult.items[0].id,
            relationship: "orders",
            sort: [{ field: "createdAt", direction: "desc" }],
            limit: 1,
          }),
        );
        scriptedToolCalls.push({ name: "traverse", args: { relationship: "orders" } });
        return {
          answer: `The last order from ${searchResult.items[0].summary} is #${traverseResult.items[0].id} for ${traverseResult.items[0].fields.total}.`,
          references: [{ type: "orders", id: traverseResult.items[0].id, reason: "latest order" }],
          needsClarification: false,
          suggestedQuestions: [],
          tokenUsage: { input: 500, output: 100 },
        };
      }),
    };

    const factory = new ToolFactory(catalog, serviceRegistry);
    chatbot = new ChatbotService(
      mockLLM as unknown as LLMService,
      catalog,
      factory,
      new DescribeEntityTool(factory),
      new SearchEntitiesTool(factory),
      new ReadEntityTool(factory),
      new TraverseTool(factory),
    );
  });

  it("answers 'last order from Acme' via search → traverse chain", async () => {
    const out = await chatbot.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["accounts", "orders"],
      messages: [{ role: "user", content: "What is the last order from Acme?" }],
    });
    expect(out.answer).toContain("Acme Corp");
    expect(out.answer).toContain("ord-1");
    expect(out.references).toEqual([{ type: "orders", id: "ord-1", reason: "latest order" }]);
    expect(scriptedToolCalls.map((c) => c.name)).toEqual(["search_entities", "traverse"]);
  });

  it("refuses cleanly when user has no modules", async () => {
    const out = await chatbot.run({
      companyId: "c1",
      userId: "u1",
      userModules: [],
      messages: [{ role: "user", content: "anything" }],
    });
    expect(out.answer).toMatch(/no enabled modules/i);
  });
});
