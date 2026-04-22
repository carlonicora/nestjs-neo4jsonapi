import { vi, describe, it, expect } from "vitest";
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

  // Second argument is the search service; this tool no longer calls it,
  // so a bare spy suffices.
  const unusedSearch: any = {};

  it("rejects filter on undescribed field with explicit error", async () => {
    const tool = new SearchEntitiesTool(factory, unusedSearch);
    const out: any = await tool.invoke(
      { type: "accounts", filters: [{ field: "secret", op: "eq", value: "x" }] },
      ctx,
      [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }],
    );
    expect(out.error).toMatch(/secret/);
  });

  it("rejects sort on undescribed field", async () => {
    const tool = new SearchEntitiesTool(factory, unusedSearch);
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
    const tool = new SearchEntitiesTool(factoryNum, unusedSearch);
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
    const tool = new SearchEntitiesTool(factory, unusedSearch);
    await tool.invoke({ type: "accounts", limit: 5000 }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(svc.findRecords).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it("returns matchMode='none' and per-item score=null for filter-only queries", async () => {
    const svc = { findRecords: vi.fn().mockResolvedValue([{ id: "a1", name: "foo", status: "active" }]) };
    registryGet.mockReturnValue(svc);
    const tool = new SearchEntitiesTool(factory, unusedSearch);
    const out: any = await tool.invoke({ type: "accounts" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);

    expect(out.matchMode).toBe("none");
    expect(out.items[0].score).toBeNull();
  });

  it("Zod schema rejects a `text` property at the build() surface", () => {
    const tool = new SearchEntitiesTool(factory, unusedSearch);
    const built: any = tool.build(ctx, []);
    const parsed = built.schema.safeParse({ type: "accounts", text: "Faby" });
    expect(parsed.success).toBe(false);
  });

  it("tool description does not mention name search or matchMode cascade", () => {
    const tool = new SearchEntitiesTool(factory, unusedSearch);
    const built: any = tool.build(ctx, []);
    expect(built.description).not.toMatch(/name/i);
    expect(built.description).not.toMatch(/matchMode/);
    expect(built.description).toMatch(/resolve_entity/);
  });
});
