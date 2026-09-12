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

  it("propagates a retry suggestion verbatim from the factory error object", async () => {
    const suggestionFactory: any = {
      resolveEntity: (_t: string, _c: any) => ({
        error: 'Entity type "bom" is not available. Retry this call now with type "boms".',
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
    expect(out.error).toMatch(/Retry this call now with type "boms"\./);
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

  it("marks every field with stage when the entity declares chat.list", async () => {
    const listCatalog = {
      getEntityDetail: (_type: string, _mods: string[]) => ({
        type: "npcs",
        moduleId: "11111111-1111-1111-1111-111111111111",
        description: "A non-player character.",
        fields: [
          { name: "name", type: "string", description: "Display name.", filterable: true, sortable: true },
          { name: "notes", type: "string", description: "Internal notes.", filterable: false, sortable: false },
        ],
        relationships: [],
        nodeName: "npc",
        labelName: "Npc",
        list: ["name"],
      }),
    } as any;

    const listFactory: any = {
      resolveEntity: (t: string, c: any) =>
        listCatalog.getEntityDetail(t, c.userModuleIds) ?? { error: `Entity type "${t}" is not available.` },
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };

    const listTool = new DescribeEntityTool(listFactory);
    const out: any = await listTool.invoke(
      { type: "npcs" },
      { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
      [],
    );

    const name = out.fields.find((f: any) => f.name === "name");
    const notes = out.fields.find((f: any) => f.name === "notes");
    expect(name.stage).toBe("list");
    expect(notes.stage).toBe("detail");
  });

  it("emits no stage key for an entity without chat.list", async () => {
    const out: any = await tool.invoke(
      { type: "accounts" },
      { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
      [],
    );

    for (const field of out.fields) {
      expect(field).not.toHaveProperty("stage");
    }
  });

  describe("writable flags", () => {
    // The model fills whatever describe_entity shows it, so a writable entity has
    // to say which fields and relationships it may actually set — otherwise the
    // refusal only lands after the user approved the action.
    const npc = (writableOverrides: Record<string, unknown>) => ({
      type: "npcs",
      moduleId: "11111111-1111-1111-1111-111111111111",
      description: "A non-player character.",
      fields: [
        { name: "name", type: "string", description: "Name.", filterable: true, sortable: true },
        { name: "tldr", type: "string", description: "Generated one-liner.", filterable: false, sortable: false },
      ],
      relationships: [
        {
          name: "campaign",
          sourceType: "npcs",
          targetType: "campaigns",
          cardinality: "one",
          description: "Scope.",
          cypherDirection: "out",
          cypherLabel: "PART_OF",
          isReverse: false,
        },
        {
          name: "scenes",
          sourceType: "npcs",
          targetType: "scenes",
          cardinality: "many",
          description: "Scenes this npc appears in.",
          cypherDirection: "out",
          cypherLabel: "APPEARS_IN",
          isReverse: false,
        },
        {
          name: "clues",
          sourceType: "npcs",
          targetType: "clues",
          cardinality: "many",
          description: "Clues carried by this npc.",
          cypherDirection: "in",
          cypherLabel: "CARRIED_BY",
          isReverse: true,
          inverseKey: "carrier",
        },
        {
          name: "related",
          sourceType: "npcs",
          targetType: "*",
          cardinality: "many",
          description: "Records linked to this one.",
          cypherDirection: "out",
          cypherLabel: "RELATES_TO",
          isReverse: false,
          polymorphic: true,
        },
      ],
      nodeName: "npc",
      labelName: "Npc",
      scope: {
        rootType: "campaigns",
        rootLabel: "Campaign",
        path: [
          {
            key: "campaign",
            cypherLabel: "PART_OF",
            cypherDirection: "out",
            targetLabel: "Campaign",
            targetType: "campaigns",
          },
        ],
      },
      writable: true,
      ...writableOverrides,
    });

    const describeNpc = async (writableOverrides: Record<string, unknown>) => {
      const writableFactory: any = {
        resolveEntity: () => npc(writableOverrides),
        capture: async (_r: any, fn: any, rec: any[]) => {
          const v = await fn();
          rec.push({});
          return v;
        },
      };
      return (await new DescribeEntityTool(writableFactory).invoke(
        { type: "npcs" },
        { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
        [],
      )) as any;
    };

    const flags = (entries: any[]) =>
      Object.fromEntries(entries.map((entry: any) => [entry.name, entry.writable])) as Record<string, unknown>;

    it("marks every described field writable for the legacy chat.writable: true", async () => {
      const out = await describeNpc({});
      expect(flags(out.fields)).toEqual({ name: true, tldr: true });
    });

    it("marks only the listed fields writable for the allow-list form", async () => {
      const out = await describeNpc({ writableFields: ["name"], writableRelationships: [] });
      expect(flags(out.fields)).toEqual({ name: true, tldr: false });
    });

    it("never marks the scope, reverse or polymorphic relationships writable", async () => {
      const out = await describeNpc({});
      expect(flags(out.relationships)).toEqual({ campaign: false, scenes: true, clues: false, related: false });
    });

    it("marks only the listed relationships writable for the allow-list form", async () => {
      const out = await describeNpc({ writableFields: ["name"], writableRelationships: [] });
      expect(flags(out.relationships)).toEqual({ campaign: false, scenes: false, clues: false, related: false });
    });

    it("omits the flag entirely for a read-only entity", async () => {
      const out: any = await tool.invoke(
        { type: "accounts" },
        { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
        [],
      );
      for (const field of out.fields) expect(field).not.toHaveProperty("writable");
      for (const relationship of out.relationships) expect(relationship).not.toHaveProperty("writable");
    });
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

/**
 * A richtext field is rendered to markdown on read and converted back on write,
 * so describe_entity has to say the field's wire format is markdown — otherwise
 * the model has no way to know the two directions match.
 */
describe("DescribeEntityTool — richtext fields", () => {
  const richtextCatalog = {
    getEntityDetail: () => ({
      type: "npcs",
      moduleId: "11111111-1111-1111-1111-111111111111",
      description: "An npc.",
      fields: [
        { name: "name", type: "string", description: "Display name.", filterable: true, sortable: true },
        {
          name: "description",
          type: "string",
          description: "Notes.",
          filterable: false,
          sortable: false,
          kind: { type: "richtext" },
        },
        {
          name: "fee",
          type: "number",
          description: "Fee.",
          filterable: true,
          sortable: true,
          kind: { type: "money", minorUnits: 2 },
        },
      ],
      relationships: [],
      nodeName: "npc",
      labelName: "Npc",
    }),
  } as any;

  const factory: any = {
    resolveEntity: (t: string, c: any) => richtextCatalog.getEntityDetail(t, c.userModuleIds),
    capture: async (_r: any, fn: any, rec: any[]) => {
      const v = await fn();
      rec.push({});
      return v;
    },
  };

  it('marks a richtext field format: "markdown" and leaves every other kind alone', async () => {
    const out: any = await new DescribeEntityTool(factory).invoke(
      { type: "npcs" },
      { companyId: "c", userId: "u", userModuleIds: ["11111111-1111-1111-1111-111111111111"] },
      [],
    );
    const byName = new Map(out.fields.map((field: any) => [field.name, field]));

    expect(byName.get("description")).toEqual({
      name: "description",
      type: "string",
      description: "Notes.",
      filterable: false,
      sortable: false,
      kind: { type: "richtext" },
      format: "markdown",
    });
    expect(byName.get("fee")).not.toHaveProperty("format");
    expect(byName.get("name")).not.toHaveProperty("format");
  });
});
