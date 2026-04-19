import { SearchEntitiesTool } from "../search-entities.tool";

describe("SearchEntitiesTool", () => {
  const catalog: any = {
    getEntityDetail: (type: string) =>
      type === "accounts"
        ? {
            type: "accounts",
            module: "crm",
            description: "A",
            fields: [
              { name: "name", type: "string", filterable: true, sortable: true },
              { name: "status", type: "string", filterable: true, sortable: true },
            ],
            relationships: [],
            nodeName: "account",
            labelName: "Account",
            textSearchFields: ["name"],
            summary: (d: any) => d.name,
          }
        : null,
  };
  const registryGet = vi.fn();
  const ctx = { companyId: "c", userId: "u", userModules: ["crm"] };
  const factory: any = {
    resolveEntity: (t: string) => catalog.getEntityDetail(t) ?? { error: "nope" },
    resolveService: (t: string) => registryGet(t),
    capture: async (_r: any, fn: any, rec: any[]) => {
      const v = await fn();
      rec.push({});
      return v;
    },
  };

  const mockSearch: any = { runCascadingSearch: vi.fn() };

  it("rejects filter on undescribed field with explicit error", async () => {
    const tool = new SearchEntitiesTool(factory, mockSearch);
    const out: any = await tool.invoke(
      { type: "accounts", filters: [{ field: "secret", op: "eq", value: "x" }] },
      ctx,
      [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }],
    );
    expect(out.error).toMatch(/secret/);
  });

  it("rejects sort on undescribed field", async () => {
    const tool = new SearchEntitiesTool(factory, mockSearch);
    const out: any = await tool.invoke({ type: "accounts", sort: [{ field: "ghost", direction: "asc" }] }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.error).toMatch(/ghost/);
  });

  it("rejects `like` on number field", async () => {
    const factoryNum: any = {
      ...factory,
      resolveEntity: () => ({
        ...catalog.getEntityDetail("accounts"),
        fields: [{ name: "amount", type: "number", filterable: true, sortable: true }],
      }),
    };
    const tool = new SearchEntitiesTool(factoryNum, mockSearch);
    const out: any = await tool.invoke(
      { type: "accounts", filters: [{ field: "amount", op: "like", value: "x" }] },
      ctx,
      [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }],
    );
    expect(out.error).toMatch(/like.*not valid/i);
  });

  it("clamps limit to [1, 50]", async () => {
    const svc = { findRecords: vi.fn(async () => []) };
    registryGet.mockReturnValue(svc);
    const tool = new SearchEntitiesTool(factory, mockSearch);
    await tool.invoke({ type: "accounts", limit: 5000 }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(svc.findRecords).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it("when text is provided, delegates to ChatbotSearchService and returns matchMode + per-item score", async () => {
    const search: any = {
      runCascadingSearch: vi.fn().mockResolvedValue({
        matchMode: "fuzzy",
        items: [
          { id: "a1", score: 8.3 },
          { id: "a2", score: 7.1 },
        ],
      }),
    };

    // findRecords mock returns hydrated records for the returned ids
    const svc = {
      findRecords: vi.fn().mockImplementation(async ({ filters }: any) => {
        const ids = filters?.find((f: any) => f.field === "id")?.value ?? [];
        return ids.map((id: string) => ({ id, name: `name-${id}`, status: "active" }));
      }),
    };

    const factoryWithSearch: any = {
      ...factory,
      resolveService: () => svc,
    };

    const tool = new SearchEntitiesTool(factoryWithSearch, search);
    const out: any = await tool.invoke({ type: "accounts", text: "Faby" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);

    expect(search.runCascadingSearch).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Faby", companyId: "c", limit: expect.any(Number) }),
    );
    expect(out.matchMode).toBe("fuzzy");
    expect(out.items.map((i: any) => i.id)).toEqual(["a1", "a2"]);
    expect(out.items.map((i: any) => i.score)).toEqual([8.3, 7.1]);
  });

  it("when text is provided but cascade returns none, tool returns matchMode='none' with empty items", async () => {
    const search: any = {
      runCascadingSearch: vi.fn().mockResolvedValue({ matchMode: "none", items: [] }),
    };
    const factoryWithSearch: any = { ...factory, resolveService: () => ({ findRecords: vi.fn() }) };

    const tool = new SearchEntitiesTool(factoryWithSearch, search);
    const out: any = await tool.invoke({ type: "accounts", text: "xyz" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);

    expect(out).toEqual({ matchMode: "none", items: [] });
  });

  it("when text is NOT provided (filter-only), matchMode is 'none' and items have null scores", async () => {
    const search: any = { runCascadingSearch: vi.fn() };
    const svc = { findRecords: vi.fn().mockResolvedValue([{ id: "a1", name: "foo", status: "active" }]) };
    const factoryWithSearch: any = { ...factory, resolveService: () => svc };

    const tool = new SearchEntitiesTool(factoryWithSearch, search);
    const out: any = await tool.invoke({ type: "accounts" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);

    expect(search.runCascadingSearch).not.toHaveBeenCalled();
    expect(out.matchMode).toBe("none");
    expect(out.items[0].score).toBeNull();
  });
});
