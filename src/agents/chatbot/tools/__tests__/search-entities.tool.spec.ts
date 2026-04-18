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

  it("rejects filter on undescribed field with explicit error", async () => {
    const tool = new SearchEntitiesTool(factory);
    const out: any = await tool.invoke(
      { type: "accounts", filters: [{ field: "secret", op: "eq", value: "x" }] },
      ctx,
      [],
    );
    expect(out.error).toMatch(/secret/);
  });

  it("rejects sort on undescribed field", async () => {
    const tool = new SearchEntitiesTool(factory);
    const out: any = await tool.invoke(
      { type: "accounts", sort: [{ field: "ghost", direction: "asc" }] },
      ctx,
      [],
    );
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
    const tool = new SearchEntitiesTool(factoryNum);
    const out: any = await tool.invoke(
      { type: "accounts", filters: [{ field: "amount", op: "like", value: "x" }] },
      ctx,
      [],
    );
    expect(out.error).toMatch(/like.*not valid/i);
  });

  it("expands `text` to LIKE over textSearchFields as additional filters", async () => {
    const svc = { findRecords: vi.fn(async () => [{ id: "a1", name: "Acme" }]) };
    registryGet.mockReturnValue(svc);
    const tool = new SearchEntitiesTool(factory);
    const out: any = await tool.invoke({ type: "accounts", text: "acme" }, ctx, []);
    expect(svc.findRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([{ field: "name", op: "like", value: "acme" }]),
      }),
    );
    expect(out.items[0]).toMatchObject({ id: "a1", type: "accounts", summary: "Acme" });
  });

  it("clamps limit to [1, 50]", async () => {
    const svc = { findRecords: vi.fn(async () => []) };
    registryGet.mockReturnValue(svc);
    const tool = new SearchEntitiesTool(factory);
    await tool.invoke({ type: "accounts", limit: 5000 }, ctx, []);
    expect(svc.findRecords).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });
});
