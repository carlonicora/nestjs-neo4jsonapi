import { DescribeEntityTool } from "../describe-entity.tool";

describe("DescribeEntityTool", () => {
  const catalog = {
    getEntityDetail: (type: string, mods: string[]) => {
      if (type !== "accounts" || !mods.includes("11111111-1111-1111-1111-111111111111")) return null;
      return {
        type: "accounts",
        moduleId: "11111111-1111-1111-1111-111111111111",
        description: "A customer or supplier.",
        fields: [{ name: "name", type: "string", description: "Display name.", filterable: true, sortable: true }],
        relationships: [
          {
            name: "orders",
            targetType: "orders",
            cardinality: "many",
            description: "Orders placed.",
            cypherDirection: "out",
            cypherLabel: "PLACED",
            isReverse: false,
            sourceType: "accounts",
          },
        ],
        nodeName: "account",
        labelName: "Account",
      };
    },
  } as any;

  const factory: any = {
    resolveEntity: (t: string, c: any) =>
      catalog.getEntityDetail(t, c.userModuleIds) ?? { error: `Entity type "${t}" is not available.` },
    capture: async (_r: any, fn: any, rec: any[]) => {
      const v = await fn();
      rec.push({});
      return v;
    },
  };
  const tool = new DescribeEntityTool(factory);

  it("returns entity detail stripped of internal cypher fields", async () => {
    const out = await tool.invoke(
      { type: "accounts" },
      { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
      [],
    );
    expect(out).toEqual({
      type: "accounts",
      description: "A customer or supplier.",
      fields: [{ name: "name", type: "string", description: "Display name.", filterable: true, sortable: true }],
      relationships: [{ name: "orders", targetType: "orders", cardinality: "many", description: "Orders placed." }],
    });
  });

  it("returns error object for unknown type without throwing", async () => {
    const out = await tool.invoke(
      { type: "widgets" },
      { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
      [],
    );
    expect(out).toEqual({ error: 'Entity type "widgets" is not available.' });
  });

  it("returns error object for type outside user modules", async () => {
    const out = await tool.invoke(
      { type: "accounts" },
      { companyId: "c", userId: "u", userModuleIds: ["22222222-2222-2222-2222-222222222222"] },
      [],
    );
    expect((out as any).error).toMatch(/not available/);
  });
});
