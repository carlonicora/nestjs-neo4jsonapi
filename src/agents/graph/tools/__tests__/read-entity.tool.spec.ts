import { vi } from "vitest";
import { ReadEntityTool } from "../read-entity.tool";
import { ToolFieldFormatterService } from "../../services/field-formatting";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";
import {
  ExternalSourceUnavailableError,
  externalSourceUnavailableResult,
} from "../../../../common/interfaces/external.entity.source.interface";

describe("ReadEntityTool", () => {
  const accounts = {
    type: "accounts",
    moduleId: "11111111-1111-1111-1111-111111111111",
    description: "A",
    fields: [{ name: "name", type: "string", description: "Display name.", filterable: true, sortable: true }],
    nodeName: "account",
    labelName: "Account",
    relationships: [
      {
        name: "orders",
        targetType: "orders",
        cardinality: "many",
        description: "x",
        cypherDirection: "out",
        cypherLabel: "PLACED",
        isReverse: false,
        sourceType: "accounts",
      },
    ],
    summary: (d: any) => d.name,
  };
  const ctx = {
    companyId: "c",
    userId: "u",
    userModuleIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
  };
  const svc = { findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })) };
  const factory: any = {
    resolveEntity: (t: string) => (t === "accounts" ? accounts : { error: "nope" }),
    resolveService: () => svc,
    capture: async (_r: any, fn: any, rec: any[]) => {
      const v = await fn();
      rec.push({});
      return v;
    },
  };

  // Minimal stand-in for ToolFieldFormatterService: projects each described
  // field straight off the record, mirroring the old buildToolFieldsOutput
  // default behaviour closely enough for these fixtures.
  const formatter: any = {
    build: ({ entity, record }: any) => {
      const fields: Record<string, unknown> = {};
      for (const f of entity.fields) fields[f.name] = record[f.name];
      return { fields };
    },
  };

  it("reads entity by id and returns described fields only", async () => {
    const tool = new ReadEntityTool(factory, {} as any, {} as any, undefined as any, formatter);
    const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out).toMatchObject({ id: "a1", type: "accounts", fields: { name: "Acme" } });
  });

  it("refuses an undescribed type with the type's compact schema", async () => {
    const tool = new ReadEntityTool(factory, {} as any, {} as any, undefined as any, formatter);
    const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, []);
    expect(out.error).toMatch(/describe_entity/);
    expect(typeof out.schema).toBe("string");
    expect(out.schema).toContain("## accounts\nA\nFields:\n- name (string) [filter O1]: Display name.");
    expect(out.schema).toContain("- orders -> orders (many): x");
    expect(out.schema).toContain("- O1: eq, ne, in, like, isNull, isNotNull");
  });

  it("read_entity carries generated", async () => {
    const judgements = {
      type: "judgements",
      moduleId: "11111111-1111-1111-1111-111111111111",
      description: "A judgement.",
      fields: [
        { name: "name", type: "string", description: "n", filterable: true, sortable: true },
        { name: "abstract", type: "string", description: "a", filterable: true, sortable: true },
        { name: "tldr", type: "string", description: "t", filterable: true, sortable: true },
      ],
      relationships: [],
      nodeName: "judgement",
      labelName: "Judgement",
      generatedFields: ["abstract", "tldr"],
    };
    const judgementFactory: any = {
      ...factory,
      resolveEntity: () => judgements,
      resolveService: () => ({
        findRecordById: vi.fn(async () => ({ id: "j1", name: "Cass. 1/2024", abstract: "Held." })),
      }),
    };
    const tool = new ReadEntityTool(
      judgementFactory,
      {} as any,
      {} as any,
      undefined as any,
      new ToolFieldFormatterService(new BlockNoteService()),
    );
    const out: any = await tool.invoke({ type: "judgements", id: "j1" }, ctx, [
      { tool: "describe_entity", input: { type: "judgements" }, durationMs: 0 },
    ]);
    expect(out).toMatchObject({ id: "j1", fields: { name: "Cass. 1/2024", abstract: "Held." } });
    expect(out.generated).toEqual(["abstract"]);
  });

  it("read_entity omits generated when the entity declares none", async () => {
    const tool = new ReadEntityTool(factory, {} as any, {} as any, undefined as any, formatter);
    const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out).not.toHaveProperty("generated");
  });

  it("rejects include for undescribed relationship", async () => {
    const tool = new ReadEntityTool(factory, {} as any, {} as any, undefined as any, formatter);
    const out: any = await tool.invoke({ type: "accounts", id: "a1", include: ["ghost"] }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);
    expect(out.error).toMatch(/ghost/);
  });

  it("materialises a bridge entity into a flat payload with __materialised", async () => {
    const moduleId = "11111111-1111-1111-1111-111111111111";
    const items = {
      type: "items",
      moduleId,
      description: "An item.",
      fields: [{ name: "name", type: "string", description: "n", filterable: true, sortable: true }],
      relationships: [],
      nodeName: "item",
      labelName: "Item",
    };
    const bomEntries = {
      type: "bom-entries",
      moduleId,
      description: "Junction record.",
      fields: [{ name: "position", type: "number", description: "row", filterable: true, sortable: true }],
      relationships: [
        {
          name: "item",
          sourceType: "bom-entries",
          targetType: "items",
          cardinality: "one",
          description: "x",
          cypherDirection: "out",
          cypherLabel: "FOR_ITEM",
          isReverse: false,
        },
      ],
      nodeName: "bomEntry",
      labelName: "BomEntry",
      bridge: { materialiseTo: ["item"] },
      summary: (d: any) => `row #${d.position ?? "?"}`,
    };

    const bridgeFactory: any = {
      resolveEntity: (t: string) => (t === "bom-entries" ? bomEntries : { error: "nope" }),
      resolveService: () => ({ findRecordById: vi.fn(async () => ({ id: "be-1", position: 1 })) }),
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const bridgeCatalog: any = {
      getEntityDetail: (t: string, _m: string[]) => (t === "items" ? items : null),
    };
    const bridgeRegistry: any = {
      get: (t: string) =>
        t === "items"
          ? { findRelatedRecordsByEdge: vi.fn(async () => [{ id: "it-1", name: "InstallationTypeA" }]) }
          : undefined,
    };

    const tool = new ReadEntityTool(bridgeFactory, bridgeCatalog, bridgeRegistry, undefined as any, formatter);
    const out: any = await tool.invoke({ type: "bom-entries", id: "be-1" }, { ...ctx, userModuleIds: [moduleId] }, [
      { tool: "describe_entity", input: { type: "bom-entries" }, durationMs: 0 },
    ]);

    expect(out.id).toBe("be-1");
    expect(out.type).toBe("bom-entries");
    expect(out.summary).toBe("row #1");
    expect(out.fields).toEqual({ position: 1 });
    expect(out.item).toMatchObject({ id: "it-1", type: "items" });
    expect(out.__materialised).toEqual(["item"]);
  });

  describe("read_entity dedup (per-pass)", () => {
    const buildAccountsFactory = (recordOrNull: unknown = { id: "a1", name: "Acme" }) => {
      const localSvc = { findRecordById: vi.fn(async () => recordOrNull) };
      const localFactory: any = {
        resolveEntity: (t: string) => (t === "accounts" ? accounts : { error: "nope" }),
        resolveService: () => localSvc,
        capture: async (_r: any, fn: any, rec: any[]) => {
          const v = await fn();
          rec.push({});
          return v;
        },
      };
      return { factory: localFactory, svc: localSvc };
    };

    it("returns the alreadyRead notice on a second read of the same (type,id) in one pass", async () => {
      const { factory: f, svc: s } = buildAccountsFactory();
      const tool = new ReadEntityTool(f, {} as any, {} as any, undefined as any, formatter);
      const readIds = new Set<string>();
      const recorder: any[] = [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }];

      const first: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, recorder, readIds);
      expect(first).toMatchObject({ id: "a1", type: "accounts", fields: { name: "Acme" } });

      const second: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, recorder, readIds);
      expect(second).toEqual({
        alreadyRead: true,
        note: expect.stringContaining("already returned in full"),
      });

      expect(s.findRecordById).toHaveBeenCalledTimes(1);
    });

    it("allows a re-read after the dedup set is cleared (retry pass)", async () => {
      const { factory: f, svc: s } = buildAccountsFactory();
      const tool = new ReadEntityTool(f, {} as any, {} as any, undefined as any, formatter);
      const readIds = new Set<string>();
      const recorder: any[] = [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }];

      const first: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, recorder, readIds);
      expect(first).toMatchObject({ id: "a1", type: "accounts" });

      readIds.clear();

      const second: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, recorder, readIds);
      expect(second).toMatchObject({ id: "a1", type: "accounts" });

      expect(s.findRecordById).toHaveBeenCalledTimes(2);
    });

    it("does not arm dedup on a failed read", async () => {
      const { factory: f, svc: s } = buildAccountsFactory(null);
      const tool = new ReadEntityTool(f, {} as any, {} as any, undefined as any, formatter);
      const readIds = new Set<string>();
      const recorder: any[] = [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }];

      const first: any = await tool.invoke({ type: "accounts", id: "missing" }, ctx, recorder, readIds);
      expect(first.error).toMatch(/No accounts with id missing/);

      const second: any = await tool.invoke({ type: "accounts", id: "missing" }, ctx, recorder, readIds);
      expect(second.error).toMatch(/No accounts with id missing/);

      expect(s.findRecordById).toHaveBeenCalledTimes(2);
    });
  });

  it("renders richtext fields to markdown in detail stage", async () => {
    const richAccounts = {
      ...accounts,
      fields: [
        { name: "name", type: "string" },
        { name: "description", type: "string", kind: { type: "richtext" as const } },
      ],
    };
    const richSvc = {
      findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme", description: "<blocknote-json>" })),
    };
    const richFactory: any = {
      resolveEntity: (t: string) => (t === "accounts" ? richAccounts : { error: "nope" }),
      resolveService: () => richSvc,
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    };
    const richFormatter: any = {
      build: vi.fn(() => ({ fields: { name: "Acme", description: "**Bold** markdown" } })),
    };

    const tool = new ReadEntityTool(richFactory, {} as any, {} as any, undefined as any, richFormatter);
    const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, [
      { tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 },
    ]);

    expect(richFormatter.build).toHaveBeenCalledWith({
      entity: richAccounts,
      record: { id: "a1", name: "Acme", description: "<blocknote-json>" },
      stage: "detail",
    });
    expect(out.fields.description).toBe("**Bold** markdown");
    expect(out.availableOnRead).toBeUndefined();
  });

  describe("detail fields (chat.detailFields)", () => {
    const detailFields = [{ name: "body", type: "string", description: "b", filterable: false, sortable: false }];
    const describedRecorder = () => [{ tool: "describe_entity", input: { type: "accounts" }, durationMs: 0 }] as any[];
    const buildFactory = (entity: any, service: any): any => ({
      resolveEntity: (t: string) => (t === "accounts" ? entity : { error: "nope" }),
      resolveService: () => service,
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    });
    const withDetail = { ...accounts, detailFields };

    it("adds declared detail fields to a single read", async () => {
      const service = {
        findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })),
        readDetailFields: vi.fn(async () => ({ body: "Hello" })),
      };
      const tool = new ReadEntityTool(
        buildFactory(withDetail, service),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, describedRecorder());
      expect(out.fields).toEqual({ name: "Acme", body: "Hello" });
      expect(service.readDetailFields).toHaveBeenCalledTimes(1);
      expect(service.readDetailFields).toHaveBeenCalledWith({ record: { id: "a1", name: "Acme" } });
    });

    it("drops undeclared keys", async () => {
      const service = {
        findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })),
        readDetailFields: vi.fn(async () => ({ body: "x", bodyS3Key: "k" })),
      };
      const tool = new ReadEntityTool(
        buildFactory(withDetail, service),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, describedRecorder());
      expect(out.fields.body).toBe("x");
      expect(out.fields.bodyS3Key).toBeUndefined();
    });

    it("drops empty detail values", async () => {
      const service = {
        findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })),
        readDetailFields: vi.fn(async () => ({ body: "" })),
      };
      const tool = new ReadEntityTool(
        buildFactory(withDetail, service),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, describedRecorder());
      expect("body" in out.fields).toBe(false);
    });

    it("a throwing hook still returns the record", async () => {
      const service = {
        findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })),
        readDetailFields: vi.fn(async () => {
          throw new Error("s3");
        }),
      };
      const tool = new ReadEntityTool(
        buildFactory(withDetail, service),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, describedRecorder());
      expect(out).toMatchObject({ id: "a1", fields: { name: "Acme" } });
      expect(out.fields).toEqual({ name: "Acme" });
      expect(out.error).toBeUndefined();
    });

    it("does not call the hook when the entity declares no detail fields", async () => {
      const service = {
        findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })),
        readDetailFields: vi.fn(async () => ({ body: "Hello" })),
      };
      const tool = new ReadEntityTool(
        buildFactory(accounts, service),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, describedRecorder());
      expect(service.readDetailFields).not.toHaveBeenCalled();
      expect(out.fields).toEqual({ name: "Acme" });
    });

    it("does not call anything on a service without the hook", async () => {
      const service = { findRecordById: vi.fn(async () => ({ id: "a1", name: "Acme" })) };
      const tool = new ReadEntityTool(
        buildFactory(withDetail, service),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke({ type: "accounts", id: "a1" }, ctx, describedRecorder());
      expect(out.fields).toEqual({ name: "Acme" });
    });

    it("adds detail fields on a bridge read", async () => {
      const moduleId = "11111111-1111-1111-1111-111111111111";
      const items = {
        type: "items",
        moduleId,
        description: "An item.",
        fields: [{ name: "name", type: "string", description: "n", filterable: true, sortable: true }],
        relationships: [],
        nodeName: "item",
        labelName: "Item",
      };
      const bomEntries = {
        type: "bom-entries",
        moduleId,
        description: "Junction record.",
        fields: [{ name: "position", type: "number", description: "row", filterable: true, sortable: true }],
        relationships: [
          {
            name: "item",
            sourceType: "bom-entries",
            targetType: "items",
            cardinality: "one",
            description: "x",
            cypherDirection: "out",
            cypherLabel: "FOR_ITEM",
            isReverse: false,
          },
        ],
        nodeName: "bomEntry",
        labelName: "BomEntry",
        bridge: { materialiseTo: ["item"] },
        summary: (d: any) => `row #${d.position ?? "?"}`,
        detailFields,
      };
      const bridgeSvc = {
        findRecordById: vi.fn(async () => ({ id: "be-1", position: 1 })),
        readDetailFields: vi.fn(async () => ({ body: "Bridge body" })),
      };
      const bridgeFactory: any = {
        resolveEntity: (t: string) => (t === "bom-entries" ? bomEntries : { error: "nope" }),
        resolveService: () => bridgeSvc,
        capture: async (_r: any, fn: any, rec: any[]) => {
          const v = await fn();
          rec.push({});
          return v;
        },
      };
      const bridgeCatalog: any = {
        getEntityDetail: (t: string, _m: string[]) => (t === "items" ? items : null),
      };
      const bridgeRegistry: any = {
        get: (t: string) =>
          t === "items"
            ? { findRelatedRecordsByEdge: vi.fn(async () => [{ id: "it-1", name: "InstallationTypeA" }]) }
            : undefined,
      };

      const tool = new ReadEntityTool(bridgeFactory, bridgeCatalog, bridgeRegistry, undefined as any, formatter);
      const out: any = await tool.invoke({ type: "bom-entries", id: "be-1" }, { ...ctx, userModuleIds: [moduleId] }, [
        { tool: "describe_entity", input: { type: "bom-entries" }, durationMs: 0 },
      ]);

      expect(out.fields.body).toBe("Bridge body");
      expect(out.fields.position).toBe(1);
      expect(out.__materialised).toEqual(["item"]);
    });
  });

  describe("includes resolved by an external source (findRelatedIds)", () => {
    const moduleId = "11111111-1111-1111-1111-111111111111";
    const entity = (type: string, labelName: string, relationships: any[] = []) => ({
      type,
      moduleId,
      description: type,
      fields: [{ name: "name", type: "string", description: "n", filterable: true, sortable: true }],
      relationships,
      nodeName: labelName.toLowerCase(),
      labelName,
      summary: (d: any) => `${type}:${d.name}`,
    });
    const massime = entity("massime", "Massima", [
      {
        name: "judgement",
        sourceType: "massime",
        targetType: "judgements",
        cardinality: "one",
        description: "x",
        cypherDirection: "out",
        cypherLabel: "SUMMARISES",
        isReverse: false,
      },
      {
        name: "law",
        sourceType: "massime",
        targetType: "laws",
        cardinality: "many",
        description: "x",
        cypherDirection: "out",
        cypherLabel: "CITES",
        isReverse: false,
        polymorphic: true,
      },
    ]);
    const entities: Record<string, any> = {
      massime,
      judgements: entity("judgements", "Judgement"),
      laws: entity("laws", "Law"),
      "law-articles": entity("law-articles", "LawArticle"),
    };
    const describedRecorder = () => [{ tool: "describe_entity", input: { type: "massime" }, durationMs: 0 }] as any[];
    const buildFactory = (services: Record<string, any>): any => ({
      resolveEntity: (t: string) => entities[t] ?? { error: "nope" },
      resolveService: (t: string) => services[t],
      capture: async (_r: any, fn: any, rec: any[]) => {
        const v = await fn();
        rec.push({});
        return v;
      },
    });
    const recordsById = (records: Record<string, any>) => vi.fn(async ({ id }: { id: string }) => records[id] ?? null);

    it("asks an opted-in source's findRelatedIds for a typed include", async () => {
      const source = {
        relatedIdsForEveryRelationship: true as const,
        findRecordById: vi.fn(async () => ({ id: "m1", name: "M" })),
        findRelatedIds: vi.fn(async () => [{ id: "j1", type: "judgements" }]),
      };
      const judgementsSvc = {
        findRecordById: recordsById({ j1: { id: "j1", name: "Cass. 1/2024" } }),
        findRelatedRecordsByEdge: vi.fn(async () => []),
      };
      const tool = new ReadEntityTool(
        buildFactory({ massime: source, judgements: judgementsSvc }),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke(
        { type: "massime", id: "m1", include: ["judgement"] },
        ctx,
        describedRecorder(),
      );

      expect(source.findRelatedIds).toHaveBeenCalledWith({
        id: "m1",
        cypherLabel: "SUMMARISES",
        limit: 50,
        relationship: { name: "judgement", direction: "out" },
      });
      expect(out.related.judgement).toEqual([{ id: "j1", type: "judgements", summary: "judgements:Cass. 1/2024" }]);
      expect(judgementsSvc.findRelatedRecordsByEdge).not.toHaveBeenCalled();
    });

    it("returns each polymorphic target by its own type", async () => {
      const source = {
        findRecordById: vi.fn(async () => ({ id: "m1", name: "M" })),
        findRelatedIds: vi.fn(async () => [
          { id: "l1", type: "laws" },
          { id: "a1", type: "law-articles" },
        ]),
      };
      const lawsSvc = { findRecordById: recordsById({ l1: { id: "l1", name: "c.c." } }) };
      const articlesSvc = { findRecordById: recordsById({ a1: { id: "a1", name: "art. 2043" } }) };
      const tool = new ReadEntityTool(
        buildFactory({ massime: source, laws: lawsSvc, "law-articles": articlesSvc }),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke({ type: "massime", id: "m1", include: ["law"] }, ctx, describedRecorder());

      expect(out.related.law).toEqual([
        { id: "l1", type: "laws", summary: "laws:c.c." },
        { id: "a1", type: "law-articles", summary: "law-articles:art. 2043" },
      ]);
      expect(lawsSvc.findRecordById).toHaveBeenCalledWith({ id: "l1" });
      expect(articlesSvc.findRecordById).toHaveBeenCalledWith({ id: "a1" });
    });

    it("a source without the opt-in keeps the edge lookup for a typed include and is asked only for polymorphic ones", async () => {
      const source = {
        findRecordById: vi.fn(async () => ({ id: "m1", name: "M" })),
        findRelatedIds: vi.fn(async () => [{ id: "l1", type: "laws" }]),
      };
      const judgementsSvc = {
        findRecordById: vi.fn(async () => null),
        findRelatedRecordsByEdge: vi.fn(async () => [{ id: "j1", name: "Cass. 1/2024" }]),
      };
      const lawsSvc = { findRecordById: recordsById({ l1: { id: "l1", name: "c.c." } }) };
      const tool = new ReadEntityTool(
        buildFactory({ massime: source, judgements: judgementsSvc, laws: lawsSvc }),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke(
        { type: "massime", id: "m1", include: ["judgement", "law"] },
        ctx,
        describedRecorder(),
      );

      expect(judgementsSvc.findRelatedRecordsByEdge).toHaveBeenCalledWith({
        cypherLabel: "SUMMARISES",
        cypherDirection: "in",
        relatedLabel: "Massima",
        relatedId: "m1",
        limit: 50,
      });
      expect(source.findRelatedIds).toHaveBeenCalledTimes(1);
      expect(source.findRelatedIds).toHaveBeenCalledWith({
        id: "m1",
        cypherLabel: "CITES",
        limit: 50,
        relationship: { name: "law", direction: "both" },
      });
      expect(out.related.judgement).toEqual([{ id: "j1", type: "judgements", summary: "judgements:Cass. 1/2024" }]);
      expect(out.related.law).toEqual([{ id: "l1", type: "laws", summary: "laws:c.c." }]);
    });

    it("keeps the edge lookup when the source has no findRelatedIds", async () => {
      const source = { findRecordById: vi.fn(async () => ({ id: "m1", name: "M" })) };
      const judgementsSvc = {
        findRecordById: vi.fn(async () => null),
        findRelatedRecordsByEdge: vi.fn(async () => [{ id: "j1", name: "Cass. 1/2024" }]),
      };
      const tool = new ReadEntityTool(
        buildFactory({ massime: source, judgements: judgementsSvc }),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke(
        { type: "massime", id: "m1", include: ["judgement"] },
        ctx,
        describedRecorder(),
      );

      expect(judgementsSvc.findRelatedRecordsByEdge).toHaveBeenCalledWith({
        cypherLabel: "SUMMARISES",
        cypherDirection: "in",
        relatedLabel: "Massima",
        relatedId: "m1",
        limit: 50,
      });
      expect(judgementsSvc.findRecordById).not.toHaveBeenCalled();
      expect(out.related.judgement).toEqual([{ id: "j1", type: "judgements", summary: "judgements:Cass. 1/2024" }]);
    });

    it("applies the scope filter and the 50 limit to external includes", async () => {
      const many = Array.from({ length: 60 }, (_, i) => ({ id: `l${i}`, type: "laws" }));
      const source = {
        findRecordById: vi.fn(async () => ({ id: "m1", name: "M" })),
        findRelatedIds: vi.fn(async () => many),
      };
      const lawsSvc = { findRecordById: vi.fn(async ({ id }: { id: string }) => ({ id, name: id })) };
      const scopeGuard: any = {
        isInScope: vi.fn(async () => true),
        filter: vi.fn(async ({ records }: any) => records.filter((r: any) => r.id !== "l1")),
      };
      const tool = new ReadEntityTool(
        buildFactory({ massime: source, laws: lawsSvc }),
        {} as any,
        {} as any,
        scopeGuard,
        formatter,
      );
      const scopedCtx = { ...ctx, scopeId: "p1", scopeType: "pratiche" };
      const out: any = await tool.invoke(
        { type: "massime", id: "m1", include: ["law"] },
        scopedCtx,
        describedRecorder(),
      );

      expect(source.findRelatedIds).toHaveBeenCalledWith({
        id: "m1",
        cypherLabel: "CITES",
        limit: 50,
        relationship: { name: "law", direction: "both" },
      });
      expect(lawsSvc.findRecordById).toHaveBeenCalledTimes(50);
      expect(scopeGuard.filter).toHaveBeenCalledWith(expect.objectContaining({ type: "laws", ctx: scopedCtx }));
      expect(out.related.law).toHaveLength(49);
      expect(out.related.law.map((r: any) => r.id)).not.toContain("l1");
    });

    it("reports an unavailable external source for that include only", async () => {
      const source = {
        relatedIdsForEveryRelationship: true as const,
        findRecordById: vi.fn(async () => ({ id: "m1", name: "M" })),
        findRelatedIds: vi.fn(async ({ cypherLabel }: { cypherLabel: string }) => {
          if (cypherLabel === "CITES") throw new ExternalSourceUnavailableError({ message: "corpus" });
          return [{ id: "j1", type: "judgements" }];
        }),
      };
      const judgementsSvc = { findRecordById: recordsById({ j1: { id: "j1", name: "Cass. 1/2024" } }) };
      const tool = new ReadEntityTool(
        buildFactory({ massime: source, judgements: judgementsSvc }),
        {} as any,
        {} as any,
        undefined as any,
        formatter,
      );
      const out: any = await tool.invoke(
        { type: "massime", id: "m1", include: ["law", "judgement"] },
        ctx,
        describedRecorder(),
      );

      expect(out.id).toBe("m1");
      expect(out.related.law).toEqual(
        externalSourceUnavailableResult(new ExternalSourceUnavailableError({ message: "corpus" })),
      );
      expect(out.related.judgement).toEqual([{ id: "j1", type: "judgements", summary: "judgements:Cass. 1/2024" }]);
    });
  });
});
