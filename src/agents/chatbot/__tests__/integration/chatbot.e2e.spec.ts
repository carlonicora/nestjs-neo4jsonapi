import { vi, describe, it, expect, beforeAll } from "vitest";
import { ChatbotService } from "../../services/chatbot.service";
import { GraphDescriptorRegistry } from "../../services/descriptor.source";
import { GraphCatalogService } from "../../services/graph.catalog.service";
import { ToolFactory } from "../../tools/tool.factory";
import { ResolveEntityTool } from "../../tools/resolve-entity.tool";
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
      const idFilter = filters?.find((f: any) => f.field === "id" && f.op === "in");
      if (idFilter) {
        const ids: string[] = idFilter.value ?? [];
        if (ids.includes("acc-1")) return [{ id: "acc-1", name: "Acme Corp" }];
        if (ids.includes("fc-1")) return [{ id: "fc-1", name: "Faby and Carlo" }];
      }
      return [];
    }),
    findRecordById: vi.fn(async ({ id }: any) =>
      id === "acc-1"
        ? { id: "acc-1", name: "Acme Corp" }
        : id === "fc-1"
          ? { id: "fc-1", name: "Faby and Carlo" }
          : null,
    ),
    findRelatedRecordsByEdge: vi.fn(async () => []),
  });
  services.set("orders", {
    model: { type: "orders" },
    findRecords: vi.fn(async () => []),
    findRecordById: vi.fn(async () => null),
    findRelatedRecordsByEdge: vi.fn(async () => [{ id: "ord-1", total: 1000, createdAt: "2026-04-01" }]),
  });
  services.set("persons", {
    model: { type: "persons" },
    findRecords: vi.fn(async () => []),
    findRecordById: vi.fn(async () => null),
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

function personDescriptor() {
  return {
    model: { type: "persons", nodeName: "person", labelName: "Person" },
    description: "An individual contact.",
    fields: {
      firstName: { type: "string", description: "First name." },
      lastName: { type: "string", description: "Last name." },
    },
    relationships: {},
    chat: {
      summary: (d: any) => `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim(),
      textSearchFields: ["firstName", "lastName"],
    },
  };
}

describe("Chatbot end-to-end (mocked LLM) — resolve → describe → traverse", () => {
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
        const resolve = tools.find((t: any) => t.name === "resolve_entity");
        const describe = tools.find((t: any) => t.name === "describe_entity");
        const traverse = tools.find((t: any) => t.name === "traverse");

        const resolveResult = JSON.parse(await resolve.func({ text: "Acme" }));
        scriptedToolCalls.push({ name: "resolve_entity", args: { text: "Acme" } });
        const topCandidate = resolveResult.items[0];

        await describe.func({ type: topCandidate.type });
        scriptedToolCalls.push({ name: "describe_entity", args: { type: topCandidate.type } });

        const traverseResult = JSON.parse(
          await traverse.func({
            fromType: topCandidate.type,
            fromId: topCandidate.id,
            relationship: "orders",
            sort: [{ field: "createdAt", direction: "desc" }],
            limit: 1,
          }),
        );
        scriptedToolCalls.push({ name: "traverse", args: { relationship: "orders" } });
        return {
          answer: `The last order from ${topCandidate.summary} is #${traverseResult.items[0].id} for ${traverseResult.items[0].fields.total}.`,
          references: [{ type: "orders", id: traverseResult.items[0].id, reason: "latest order" }],
          needsClarification: false,
          suggestedQuestions: [],
          tokenUsage: { input: 500, output: 100 },
        };
      }),
    };

    const searchMock: any = {
      resolveEntity: vi.fn().mockResolvedValue({
        matchMode: "exact",
        items: [{ type: "accounts", id: "acc-1", summary: "Acme Corp", score: 9.5 }],
      }),
    };

    const factory = new ToolFactory(catalog, serviceRegistry);
    chatbot = new ChatbotService(
      mockLLM as unknown as LLMService,
      catalog,
      factory,
      new ResolveEntityTool(factory, searchMock as unknown as ChatbotSearchService),
      new DescribeEntityTool(factory),
      new SearchEntitiesTool(factory, searchMock as unknown as ChatbotSearchService),
      new ReadEntityTool(factory),
      new TraverseTool(factory),
    );
  });

  it("answers 'last order from Acme' via resolve → describe → traverse chain", async () => {
    const out = await chatbot.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["accounts", "orders"],
      messages: [{ role: "user", content: "What is the last order from Acme?" }],
    });
    expect(out.answer).toContain("Acme Corp");
    expect(out.answer).toContain("ord-1");
    expect(out.references).toEqual([{ type: "orders", id: "ord-1", reason: "latest order" }]);
    expect(scriptedToolCalls.map((c) => c.name)).toEqual([
      "resolve_entity",
      "describe_entity",
      "traverse",
    ]);
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

describe("Chatbot e2e regression — literal-phrase resolves to Account (Faby and Carlo)", () => {
  let chatbot: ChatbotService;

  beforeAll(() => {
    const registry = new GraphDescriptorRegistry();
    registry.register({ descriptor: accountDescriptor(), module: "accounts" });
    registry.register({ descriptor: orderDescriptor(), module: "orders" });
    registry.register({ descriptor: personDescriptor(), module: "persons" });
    const catalog = new GraphCatalogService(registry);
    catalog.buildCatalog();

    const serviceRegistry = {
      get: (t: string) => {
        if (t === "accounts") {
          return {
            model: { type: "accounts" },
            findRecords: vi.fn(async () => []),
            findRecordById: vi.fn(async ({ id }: any) =>
              id === "fc-1" ? { id: "fc-1", name: "Faby and Carlo" } : null,
            ),
            findRelatedRecordsByEdge: vi.fn(async () => [{ id: "o1", total: 79544, createdAt: "2026-03-25" }]),
          };
        }
        if (t === "orders") {
          return {
            model: { type: "orders" },
            findRecords: vi.fn(async () => []),
            findRecordById: vi.fn(async () => null),
            findRelatedRecordsByEdge: vi.fn(async () => [{ id: "o1", total: 79544, createdAt: "2026-03-25" }]),
          };
        }
        if (t === "persons") {
          return {
            model: { type: "persons" },
            findRecords: vi.fn(async () => []),
            findRecordById: vi.fn(async () => null),
          };
        }
        return undefined;
      },
      listTypes: () => ["accounts", "orders", "persons"],
    } as any;

    const mockLLM = {
      call: vi.fn(async ({ tools }: any) => {
        const resolve = tools.find((t: any) => t.name === "resolve_entity");
        const describe = tools.find((t: any) => t.name === "describe_entity");
        const traverse = tools.find((t: any) => t.name === "traverse");

        const resolveResult = JSON.parse(await resolve.func({ text: "Faby and Carlo" }));
        const top = resolveResult.items[0];
        await describe.func({ type: top.type });
        const traverseResult = JSON.parse(
          await traverse.func({
            fromType: top.type,
            fromId: top.id,
            relationship: "orders",
            sort: [{ field: "createdAt", direction: "desc" }],
            limit: 1,
          }),
        );

        return {
          answer: `The last order from ${top.summary} is ORD ${traverseResult.items[0].id}.`,
          references: [
            { type: top.type, id: top.id, reason: "account the user asked about" },
            { type: "orders", id: traverseResult.items[0].id, reason: "the last order" },
          ],
          needsClarification: false,
          suggestedQuestions: [],
          tokenUsage: { input: 200, output: 50 },
        };
      }),
    };

    const searchMock: any = {
      resolveEntity: vi.fn().mockResolvedValue({
        matchMode: "exact",
        items: [{ type: "accounts", id: "fc-1", summary: "Faby and Carlo", score: 9.9 }],
      }),
    };

    const factory = new ToolFactory(catalog, serviceRegistry);
    chatbot = new ChatbotService(
      mockLLM as unknown as LLMService,
      catalog,
      factory,
      new ResolveEntityTool(factory, searchMock as unknown as ChatbotSearchService),
      new DescribeEntityTool(factory),
      new SearchEntitiesTool(factory, searchMock as unknown as ChatbotSearchService),
      new ReadEntityTool(factory),
      new TraverseTool(factory),
    );
  });

  it("calls resolve_entity with the literal phrase and references the Account (not either Person)", async () => {
    const out = await chatbot.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["accounts", "orders", "persons"],
      messages: [{ role: "user", content: "Show me the last order from Faby and Carlo" }],
    });

    // resolve_entity must have been invoked with the literal phrase
    expect(out.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "resolve_entity",
          input: expect.objectContaining({ text: "Faby and Carlo" }),
        }),
      ]),
    );

    // search_entities should never be called by name — and the schema no longer accepts `text` anyway.
    const searchCalls = out.toolCalls.filter((c) => c.tool === "search_entities");
    for (const c of searchCalls) {
      expect((c.input as any).text).toBeUndefined();
    }

    // References anchor on the Account, not on Persons.
    expect(out.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "accounts", id: "fc-1" })]),
    );
    expect(out.needsClarification).toBe(false);
  });
});

describe("Chatbot e2e regression — follow-up reuses resolved Account id via hydration", () => {
  let chatbot: ChatbotService;
  let mockLLM: any;

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
            findRecords: vi.fn(async () => []),
            findRecordById: vi.fn(async ({ id }: any) =>
              id === "fc-1" ? { id: "fc-1", name: "Faby and Carlo" } : null,
            ),
            findRelatedRecordsByEdge: vi.fn(async () => []),
          };
        }
        if (t === "orders") {
          return {
            model: { type: "orders" },
            findRecords: vi.fn(async () => []),
            findRecordById: vi.fn(async () => null),
            findRelatedRecordsByEdge: vi.fn(async () => [
              { id: "ord-7", total: 5000, createdAt: "2026-04-15" },
              { id: "ord-8", total: 2500, createdAt: "2026-04-18" },
            ]),
          };
        }
        return undefined;
      },
      listTypes: () => ["accounts", "orders"],
    } as any;

    // Message-inspecting mock LLM.
    // - If incoming context (systemPrompts or history) includes a focus block
    //   mentioning accounts/fc-1, it takes the "traverse from known id" path.
    // - Otherwise, it falls back to resolve_entity (the regressed behavior).
    mockLLM = {
      call: vi.fn(async ({ systemPrompts, history, tools }: any) => {
        const systemText = (systemPrompts ?? []).join("\n");
        const historyText = (history ?? []).map((m: any) => String(m?.content ?? "")).join("\n");
        const allText = `${systemText}\n${historyText}`;
        const hasFocusAccount = allText.includes('"type": "accounts"') && allText.includes('"id": "fc-1"');

        const resolve = tools.find((t: any) => t.name === "resolve_entity");
        const describe = tools.find((t: any) => t.name === "describe_entity");
        const traverse = tools.find((t: any) => t.name === "traverse");

        if (hasFocusAccount) {
          // Correct path: skip resolve_entity entirely, use the known id.
          await describe.func({ type: "accounts" });
          await describe.func({ type: "orders" });
          const traverseResult = JSON.parse(
            await traverse.func({
              fromType: "accounts",
              fromId: "fc-1",
              relationship: "orders",
              sort: [{ field: "createdAt", direction: "desc" }],
              limit: 5,
            }),
          );
          return {
            answer: `There are ${traverseResult.items.length} orders for Faby and Carlo.`,
            references: [
              { type: "accounts", id: "fc-1", reason: "the account the user asked about" },
              ...traverseResult.items.map((it: any) => ({
                type: "orders",
                id: it.id,
                reason: "one of the listed orders",
              })),
            ],
            needsClarification: false,
            suggestedQuestions: [],
            tokenUsage: { input: 100, output: 50 },
          };
        }

        // Regressed path — never reached if hydration is working.
        await resolve.func({ text: "Faby and Carlo" });
        return {
          answer: "Fell back to resolve.",
          references: [],
          needsClarification: false,
          suggestedQuestions: [],
          tokenUsage: { input: 100, output: 50 },
        };
      }),
    };

    const searchMock: any = {
      resolveEntity: vi.fn().mockResolvedValue({ matchMode: "none", items: [] }),
    };

    const factory = new ToolFactory(catalog, serviceRegistry);
    chatbot = new ChatbotService(
      mockLLM as unknown as LLMService,
      catalog,
      factory,
      new ResolveEntityTool(factory, searchMock as unknown as ChatbotSearchService),
      new DescribeEntityTool(factory),
      new SearchEntitiesTool(factory, searchMock as unknown as ChatbotSearchService),
      new ReadEntityTool(factory),
      new TraverseTool(factory),
    );
  });

  it("given a hydration block with the resolved Account, follow-up uses traverse and skips resolve_entity", async () => {
    const hydrationSystemMessage = [
      "## Entities already in this conversation",
      "",
      "### Full records from the previous answer",
      'These are the entities your previous answer was about. When the user\'s new question refers to any of them — by name or implicitly ("these", "them", "other orders", "their invoices") — use their id directly. Do not call resolve_entity for a name that matches one of these.',
      "",
      JSON.stringify([{ id: "fc-1", name: "Faby and Carlo", type: "accounts" }], null, 2),
      "",
    ].join("\n");

    const result = await chatbot.run({
      companyId: "c1",
      userId: "u1",
      userModules: ["accounts", "orders"],
      messages: [
        { role: "system", content: hydrationSystemMessage },
        { role: "user", content: "What are the latest orders by Faby and Carlo?" },
        { role: "assistant", content: "There are 2 orders for Faby and Carlo: ord-7 and ord-8." },
        { role: "user", content: "Are there other orders for Faby and Carlo?" },
      ],
    });

    // Assertion 1: resolve_entity NOT called for the already-resolved name
    const resolveCalls = result.toolCalls.filter((c) => c.tool === "resolve_entity");
    expect(resolveCalls).toEqual([]);

    // Assertion 2: at least one traverse from the Account id from turn 1
    const traverseFromAccount = result.toolCalls.filter(
      (c) => c.tool === "traverse" && (c.input as any)?.fromId === "fc-1",
    );
    expect(traverseFromAccount.length).toBeGreaterThan(0);

    // Sanity: the answer mentions the account
    expect(result.answer).toContain("Faby and Carlo");
  });
});
