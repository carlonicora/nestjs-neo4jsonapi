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

  it("propagates a Did-you-mean suggestion verbatim from the factory error object", async () => {
    const suggestionFactory: any = {
      resolveEntity: (_t: string, _c: any) => ({
        error: 'Entity type "bom" is not available. Did you mean "boms"?',
        suggestion: "boms",
      }),
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const t = new DescribeEntityTool(suggestionFactory);
    const out: any = await t.invoke(
      { type: "bom" },
      { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
      [],
    );
    expect(out.error).toMatch(/Did you mean "boms"\?/);
    expect(out.suggestion).toBe("boms");
  });

  it("returns error object for type outside user modules", async () => {
    const out = await tool.invoke(
      { type: "accounts" },
      { companyId: "c", userId: "u", userModuleIds: ["22222222-2222-2222-2222-222222222222"] },
      [],
    );
    expect((out as any).error).toMatch(/not available/);
  });

  it("includes bridge in the response when the entity is a bridge", async () => {
    const bridgeCatalog = {
      getEntityDetail: (_type: string, _mods: string[]) => ({
        type: "bom-entries",
        moduleId: "11111111-1111-1111-1111-111111111111",
        description: "Junction record.",
        fields: [{ name: "position", type: "number", description: "Row order.", filterable: true, sortable: true }],
        relationships: [
          {
            name: "item",
            targetType: "items",
            cardinality: "one",
            description: "Item this entry refers to.",
            cypherDirection: "out",
            cypherLabel: "FOR_ITEM",
            isReverse: false,
            sourceType: "bom-entries",
          },
        ],
        nodeName: "bomEntry",
        labelName: "BomEntry",
        bridge: { materialiseTo: ["item"] },
      }),
    } as any;

    const bridgeFactory: any = {
      resolveEntity: (t: string, c: any) =>
        bridgeCatalog.getEntityDetail(t, c.userModuleIds) ?? { error: `Entity type "${t}" is not available.` },
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };

    const bridgeTool = new DescribeEntityTool(bridgeFactory);
    const out = await bridgeTool.invoke(
      { type: "bom-entries" },
      { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
      [],
    );

    expect((out as any).bridge).toEqual({ materialiseTo: ["item"] });
    expect((out as any).type).toBe("bom-entries");
  });
});
