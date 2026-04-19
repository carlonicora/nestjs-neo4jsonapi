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
import { ChatbotSearchService } from "../../services/chatbot.search.service";

function makeFakeServiceRegistry() {
  const services = new Map<string, any>();
  services.set("accounts", {
    model: { type: "accounts" },
    findRecords: vi.fn(async ({ filters }: any) => {
      const name = filters?.find((f: any) => f.field === "name")?.value ?? "";
      if (String(name).toLowerCase() === "acme") return [{ id: "acc-1", name: "Acme Corp" }];
      // Also handle id-in filter (used by cascade search path)
      const idFilter = filters?.find((f: any) => f.field === "id" && f.op === "in");
      if (idFilter) {
        const ids: string[] = idFilter.value ?? [];
        if (ids.includes("acc-1")) return [{ id: "acc-1", name: "Acme Corp" }];
        if (ids.includes("fc-1")) return [{ id: "fc-1", name: "Faby and Carlo" }];
      }
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

    // Provide a mock ChatbotSearchService that returns an "exact" hit for "acme"
    const searchMock = {
      runCascadingSearch: vi.fn().mockResolvedValue({
        matchMode: "exact",
        items: [{ id: "acc-1", score: 9.5 }],
      }),
    };

    const factory = new ToolFactory(catalog, serviceRegistry);
    chatbot = new ChatbotService(
      mockLLM as unknown as LLMService,
      catalog,
      factory,
      new DescribeEntityTool(factory),
      new SearchEntitiesTool(factory, searchMock as unknown as ChatbotSearchService),
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

describe("Chatbot e2e regression — literal-phrase search (Faby and Carlo)", () => {
  let chatbot: ChatbotService;
  let searchMock: { runCascadingSearch: ReturnType<typeof vi.fn> };

  beforeAll(() => {
    const registry = new GraphDescriptorRegistry();
    registry.register({ descriptor: accountDescriptor(), module: "accounts" });
    registry.register({ descriptor: orderDescriptor(), module: "orders" });
    const catalog = new GraphCatalogService(registry);
    catalog.buildCatalog();

    const serviceRegistry = {
      get: (t: string) => {
        if (t === "accounts") {
          return {
            model: { type: "accounts" },
            findRecords: vi.fn(async ({ filters }: any) => {
              const idFilter = filters?.find((f: any) => f.field === "id" && f.op === "in");
              if (idFilter && (idFilter.value as string[]).includes("fc-1")) {
                return [{ id: "fc-1", name: "Faby and Carlo" }];
              }
              return [];
            }),
            findRecordById: vi.fn(async () => null),
          };
        }
        if (t === "orders") {
          return {
            model: { type: "orders" },
            findRecords: vi.fn(async () => []),
            findRelatedRecords: vi.fn(async () => []),
          };
        }
        return undefined;
      },
      listTypes: () => ["accounts", "orders"],
    } as any;

    // The LLM issues a SINGLE search_entities call with the LITERAL phrase "Faby and Carlo"
    // and immediately produces an answer — no clarification, no splitting the name.
    const mockLLM = {
      call: vi.fn(async ({ tools }: any) => {
        const search = tools.find((t: any) => t.name === "search_entities");
        const searchResult = JSON.parse(await search.func({ type: "accounts", text: "Faby and Carlo" }));
        return {
          answer: `Found account: ${searchResult.items[0]?.summary ?? "none"}.`,
          references: [{ type: "accounts", id: "fc-1", reason: "matched account" }],
          needsClarification: false,
          suggestedQuestions: [],
          tokenUsage: { input: 200, output: 50 },
        };
      }),
    };

    // The search service returns an exact FULLTEXT hit for the literal phrase
    searchMock = {
      runCascadingSearch: vi.fn().mockResolvedValue({
        matchMode: "exact",
        items: [{ id: "fc-1", score: 9.9 }],
      }),
    };

    const factory = new ToolFactory(catalog, serviceRegistry);
    chatbot = new ChatbotService(
      mockLLM as unknown as LLMService,
      catalog,
      factory,
      new DescribeEntityTool(factory),
      new SearchEntitiesTool(factory, searchMock as unknown as ChatbotSearchService),
      new ReadEntityTool(factory),
      new TraverseTool(factory),
    );
  });

  it("passes the literal phrase 'Faby and Carlo' as text to search_entities — no clarification", async () => {
    const out = await chatbot.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["accounts", "orders"],
      messages: [{ role: "user", content: "Show me the last order from Faby and Carlo" }],
    });

    // The LLM must have called search_entities with the literal phrase as text
    expect(out.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "search_entities",
          input: expect.objectContaining({ type: "accounts", text: "Faby and Carlo" }),
        }),
      ]),
    );

    // No clarification should be needed — FULLTEXT hit was exact
    expect(out.needsClarification).toBe(false);

    // The cascading search service was invoked with the literal phrase
    expect(searchMock.runCascadingSearch).toHaveBeenCalledWith(expect.objectContaining({ text: "Faby and Carlo" }));
  });
});
