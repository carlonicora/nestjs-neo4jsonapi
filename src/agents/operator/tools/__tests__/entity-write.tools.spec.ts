import { describe, expect, it, vi } from "vitest";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";
import { EntityWriteTools } from "../entity-write.tools";

const npc = {
  type: "npcs",
  labelName: "Npc",
  nodeName: "npc",
  moduleId: "m-npc",
  description: "An npc.",
  writable: true,
  fields: [
    { name: "name", type: "string", description: "Name.", filterable: true, sortable: true },
    { name: "description", type: "string", description: "Notes.", filterable: false, sortable: false },
  ],
  relationships: [],
  scope: {
    rootType: "campaigns",
    rootLabel: "Campaign",
    path: [
      {
        key: "campaign",
        dtoKey: "campaign",
        cypherLabel: "PART_OF",
        cypherDirection: "out",
        targetLabel: "Campaign",
        targetType: "campaigns",
      },
    ],
  },
  // The undescribed owner relationship the host app's own clients fill with the
  // current user on create; the catalog compiles it from the full descriptor.
  owner: { key: "owner", dtoKey: "owner", type: "users" },
} as any;

const readOnly = { ...npc, type: "sessions", writable: false };
const ctx = { companyId: "c", userId: "u", userModuleIds: ["m-npc"], scopeId: "camp-1", scopeType: "campaigns" };

/** Same entity, plus the two relationships the proposal hooks have to resolve. */
const npcRelated = {
  ...npc,
  relationships: [
    {
      name: "campaign",
      dtoKey: "campaign",
      sourceType: "npcs",
      targetType: "campaigns",
      cardinality: "one",
      description: "Scope.",
      cypherDirection: "out",
      cypherLabel: "PART_OF",
      isReverse: false,
    },
    {
      name: "related",
      dtoKey: "related",
      sourceType: "npcs",
      targetType: "npcs",
      cardinality: "many",
      description: "Related npcs.",
      cypherDirection: "out",
      cypherLabel: "RELATED_TO",
      isReverse: false,
    },
  ],
} as any;

// Real-shaped uuids: the summaries and proposals must never echo one back.
const MARCUS = "c81d6ac7-1111-4b0e-9f11-0000000000a1";
const ZOE = "042ec319-2222-4b0e-9f11-0000000000a2";
const BOB = "7f3a91de-3333-4b0e-9f11-0000000000a3";
const GHOST = "deadbeef-4444-4b0e-9f11-0000000000a4";

const NAMES: Record<string, string> = { [MARCUS]: "Marcus", [ZOE]: "Zoe", [BOB]: "Bob" };

/** Catalog + registry + scope guard wired so every known id resolves to its name. */
function buildResolvingTools(options: { inScope?: (id: string) => boolean } = {}) {
  const inScope = options.inScope ?? (() => true);
  const catalog = {
    getAllChatEnabledEntities: () => [npcRelated],
    getEntityDetail: (type: string) => (type === "npcs" ? npcRelated : null),
  };
  const findRecordById = vi.fn(async ({ id }: { id: string }) => (NAMES[id] ? { id, name: NAMES[id] } : null));
  const registry = { get: (type: string) => (type === "npcs" ? { findRecordById } : undefined) };
  const scopeGuard = { isInScope: vi.fn(async ({ id }: { id: string }) => inScope(id)) };

  const definitions = new EntityWriteTools(catalog as any, registry as any, scopeGuard as any).buildDefinitions(
    ctx as any,
    [],
  );
  const byName = new Map(definitions.map((definition) => [definition.tool.name, definition]));
  return { definitions, byName, findRecordById, scopeGuard };
}

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}/i;

const relationship = (overrides: Record<string, unknown>) => ({
  sourceType: "npcs",
  cardinality: "many",
  description: "A relationship.",
  cypherDirection: "out",
  cypherLabel: "REL",
  isReverse: false,
  // The catalog compiles `dtoKey` for every relationship: the descriptor's own
  // override, or the name when it declares none.
  dtoKey: overrides.name,
  ...overrides,
});

/**
 * The object form of `chat.writable`: `tldr` is described (the assistant may READ
 * it) but system-generated, and `related` is the read-only polymorphic traversal.
 * Neither may be written.
 */
const npcLimited = {
  ...npc,
  fields: [
    ...npc.fields,
    { name: "tldr", type: "string", description: "Generated one-liner.", filterable: false, sortable: false },
  ],
  relationships: [
    relationship({ name: "campaign", targetType: "campaigns", cardinality: "one", cypherLabel: "PART_OF" }),
    relationship({ name: "scenes", targetType: "scenes", cypherLabel: "APPEARS_IN" }),
    relationship({ name: "related", targetType: "npcs", cypherLabel: "RELATES_TO" }),
  ],
  writableFields: ["name", "description"],
  writableRelationships: ["scenes"],
} as any;

/** The legacy `chat.writable: true`: the same entity with no allow-lists at all. */
const npcLegacy = {
  ...npcLimited,
  writableFields: undefined,
  writableRelationships: undefined,
} as any;

/** Catalog + service doubles for one entity, with every write recorded. */
function buildTools(entity: any) {
  const service = {
    create: vi.fn(async () => undefined),
    patch: vi.fn(async () => undefined),
    createFromDTO: vi.fn(async () => undefined),
    patchFromDTO: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    addToRelationshipFromDTO: vi.fn(async () => undefined),
    removeFromRelationshipFromDTO: vi.fn(async () => undefined),
    findRecordById: vi.fn(async ({ id }: { id: string }) => ({ id, name: NAMES[id] ?? "Someone" })),
  };
  const catalog = {
    getAllChatEnabledEntities: () => [entity],
    getEntityDetail: (type: string) => (type === entity.type ? entity : null),
  };
  const tools = new EntityWriteTools(
    catalog as any,
    { get: () => service } as any,
    { isInScope: async () => true } as any,
  );
  const byName = new Map(tools.buildDefinitions(ctx as any, []).map((d) => [d.tool.name, d]));
  return { tools, service, byName };
}

/** Every write the doubles could have received, so "nothing was written" is checkable. */
const writeCalls = (service: any) =>
  [
    service.create,
    service.patch,
    service.createFromDTO,
    service.patchFromDTO,
    service.delete,
    service.addToRelationshipFromDTO,
    service.removeFromRelationshipFromDTO,
  ].reduce((total, mock) => total + mock.mock.calls.length, 0);

/** The relationships every npcs create carries from the run itself, never from the model. */
const RUN_RELATIONSHIPS = {
  campaign: { data: { type: "campaigns", id: "camp-1" } },
  owner: { data: { type: "users", id: "u" } },
};

describe("EntityWriteTools — chat.writable allow-lists", () => {
  const FIELD_ERROR = 'Field "tldr" on npcs is not writable. Writable fields: [name, description].';
  const RELATIONSHIP_ERROR = 'Relationship "related" on npcs is not writable. Writable relationships: [scenes].';

  it("refuses to create with a field outside the writable list", async () => {
    const { tools, service } = buildTools(npcLimited);
    const result: any = await tools.createEntity(
      { type: "npcs", fields: { name: "Marcus", tldr: "A guard." } },
      ctx as any,
      [],
    );

    expect(result.error).toBe(FIELD_ERROR);
    expect(writeCalls(service)).toBe(0);
  });

  it("refuses to update a field outside the writable list", async () => {
    const { tools, service } = buildTools(npcLimited);
    const result: any = await tools.updateEntity(
      { type: "npcs", id: MARCUS, fields: { tldr: "A guard." } },
      ctx as any,
      [],
    );

    expect(result.error).toBe(FIELD_ERROR);
    expect(writeCalls(service)).toBe(0);
  });

  it("refuses to create with a relationship outside the writable list", async () => {
    const { tools, service } = buildTools(npcLimited);
    const result: any = await tools.createEntity(
      { type: "npcs", fields: { name: "Marcus" }, relationships: { related: ZOE } },
      ctx as any,
      [],
    );

    expect(result.error).toBe(RELATIONSHIP_ERROR);
    expect(writeCalls(service)).toBe(0);
  });

  it("refuses to link a relationship outside the writable list", async () => {
    const { tools, service } = buildTools(npcLimited);
    const result: any = await tools.linkEntities(
      { type: "npcs", id: MARCUS, relationship: "related", targetIds: [ZOE] },
      ctx as any,
      [],
    );

    expect(result.error).toBe(RELATIONSHIP_ERROR);
    expect(writeCalls(service)).toBe(0);
  });

  it("refuses to unlink a relationship outside the writable list", async () => {
    const { tools, service } = buildTools(npcLimited);
    const result: any = await tools.unlinkEntities(
      { type: "npcs", id: MARCUS, relationship: "related", targetIds: [ZOE] },
      ctx as any,
      [],
    );

    expect(result.error).toBe(RELATIONSHIP_ERROR);
    expect(writeCalls(service)).toBe(0);
  });

  it("writes a listed field and a listed relationship", async () => {
    const { tools, service } = buildTools(npcLimited);

    const created: any = await tools.createEntity(
      { type: "npcs", fields: { name: "Marcus", description: "A guard." }, relationships: { scenes: ZOE } },
      ctx as any,
      [],
    );
    const linked: any = await tools.linkEntities(
      { type: "npcs", id: MARCUS, relationship: "scenes", targetIds: [ZOE] },
      ctx as any,
      [],
    );

    expect(created.created).toBe(true);
    expect(service.createFromDTO).toHaveBeenCalledWith({
      data: {
        type: "npcs",
        id: expect.any(String),
        attributes: { name: "Marcus", description: "A guard." },
        relationships: { scenes: { data: [{ type: "scenes", id: ZOE }] }, ...RUN_RELATIONSHIPS },
      },
    });
    expect(service.create).not.toHaveBeenCalled();
    expect(linked.linked).toBe(true);
    expect(service.addToRelationshipFromDTO).toHaveBeenCalledWith(
      expect.objectContaining({ id: MARCUS, relationship: "scenes" }),
    );
  });

  it("leaves the legacy chat.writable: true unchanged — every field and forward relationship", async () => {
    const { tools, service } = buildTools(npcLegacy);

    const created: any = await tools.createEntity(
      { type: "npcs", fields: { name: "Marcus", tldr: "A guard." }, relationships: { related: ZOE } },
      ctx as any,
      [],
    );

    expect(created.created).toBe(true);
    expect(service.createFromDTO).toHaveBeenCalledWith({
      data: {
        type: "npcs",
        id: expect.any(String),
        attributes: { name: "Marcus", tldr: "A guard." },
        relationships: { related: { data: [{ type: "npcs", id: ZOE }] }, ...RUN_RELATIONSHIPS },
      },
    });
  });

  it("still refuses the scope relationship under the legacy form", async () => {
    const { tools, service } = buildTools(npcLegacy);
    const result: any = await tools.linkEntities(
      { type: "npcs", id: MARCUS, relationship: "campaign", targetIds: ["camp-2"] },
      ctx as any,
      [],
    );

    expect(result.error).toBe('Relationship "campaign" on npcs cannot be changed.');
    expect(writeCalls(service)).toBe(0);
  });
});

/**
 * Every write goes through the SAME `*FromDTO` entry point a controller uses, so
 * the host application's overrides (ownership check, summariser scheduling) and
 * its `contextKey` relationships fire. Calling the plain `create`/`patch` wrote a
 * record the app's own read query could not see, and the tool answered the model
 * `not found` for a record that existed.
 */
describe("EntityWriteTools — the DTO write path", () => {
  /** Same entity, with the descriptor's `dtoKey` differing from the catalog name. */
  const npcAliased = {
    ...npcLimited,
    relationships: [
      relationship({ name: "campaign", targetType: "campaigns", cardinality: "one", cypherLabel: "PART_OF" }),
      relationship({ name: "scenes", dtoKey: "scene-list", targetType: "scenes", cypherLabel: "APPEARS_IN" }),
      relationship({ name: "related", targetType: "npcs", cypherLabel: "RELATES_TO" }),
    ],
    scope: {
      rootType: "campaigns",
      rootLabel: "Campaign",
      path: [
        {
          key: "campaign",
          dtoKey: "campaigns",
          cypherLabel: "PART_OF",
          cypherDirection: "out",
          targetLabel: "Campaign",
          targetType: "campaigns",
        },
      ],
    },
  } as any;

  it("creates through createFromDTO, never through create", async () => {
    const { tools, service } = buildTools(npcLimited);

    await tools.createEntity({ type: "npcs", fields: { name: "Marcus" } }, ctx as any, []);

    expect(service.createFromDTO).toHaveBeenCalledTimes(1);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("sets the owner relationship from the run's user", async () => {
    const { tools, service } = buildTools(npcLimited);

    await tools.createEntity({ type: "npcs", fields: { name: "Marcus" } }, ctx as any, []);

    expect(service.createFromDTO.mock.calls[0][0].data.relationships.owner).toEqual({
      data: { type: "users", id: "u" },
    });
  });

  it("omits the owner relationship when the catalogued entity declares none", async () => {
    const { tools, service } = buildTools({ ...npcLimited, owner: undefined });

    await tools.createEntity({ type: "npcs", fields: { name: "Marcus" } }, ctx as any, []);

    expect(service.createFromDTO.mock.calls[0][0].data.relationships).not.toHaveProperty("owner");
  });

  it("pins the record to the run's scope under the hop's dtoKey and targetType", async () => {
    const { tools, service } = buildTools(npcAliased);

    await tools.createEntity(
      { type: "npcs", fields: { name: "Marcus" }, relationships: { campaign: "camp-999" } },
      ctx as any,
      [],
    );

    const { relationships } = service.createFromDTO.mock.calls[0][0].data;
    expect(relationships.campaigns).toEqual({ data: { type: "campaigns", id: "camp-1" } });
    expect(relationships).not.toHaveProperty("campaign");
  });

  it("sends a relationship under its dtoKey, not its catalog name", async () => {
    const { tools, service } = buildTools(npcAliased);

    await tools.createEntity(
      { type: "npcs", fields: { name: "Marcus" }, relationships: { scenes: ZOE } },
      ctx as any,
      [],
    );

    const { relationships } = service.createFromDTO.mock.calls[0][0].data;
    expect(relationships["scene-list"]).toEqual({ data: [{ type: "scenes", id: ZOE }] });
    expect(relationships).not.toHaveProperty("scenes");
  });

  it("updates through patchFromDTO with attributes only — never a PUT", async () => {
    const { tools, service } = buildTools(npcLimited);

    const updated: any = await tools.updateEntity(
      { type: "npcs", id: MARCUS, fields: { description: "A guard." } },
      ctx as any,
      [],
    );

    expect(updated.updated).toBe(true);
    expect(service.patchFromDTO).toHaveBeenCalledWith({
      data: { type: "npcs", id: MARCUS, attributes: { description: "A guard." } },
    });
    expect(service.patch).not.toHaveBeenCalled();
  });

  it("repoints a to-one relationship through patchFromDTO, under its dtoKey", async () => {
    const npcToOne = {
      ...npcLimited,
      relationships: [
        relationship({ name: "campaign", targetType: "campaigns", cardinality: "one", cypherLabel: "PART_OF" }),
        relationship({
          name: "faction",
          dtoKey: "factions",
          targetType: "factions",
          cardinality: "one",
          cypherLabel: "BELONGS_TO",
        }),
      ],
      writableRelationships: ["faction"],
    } as any;
    const { tools, service } = buildTools(npcToOne);

    const linked: any = await tools.linkEntities(
      { type: "npcs", id: MARCUS, relationship: "faction", targetIds: [ZOE] },
      ctx as any,
      [],
    );

    expect(linked.linked).toBe(true);
    expect(service.patchFromDTO).toHaveBeenCalledWith({
      data: {
        type: "npcs",
        id: MARCUS,
        relationships: { factions: { data: { type: "factions", id: ZOE } } },
      },
    });
    expect(service.patch).not.toHaveBeenCalled();
  });
});

describe("EntityWriteTools — the validate hook", () => {
  it("gives every write tool a validate hook", () => {
    const { byName } = buildTools(npcLimited);
    for (const definition of byName.values()) expect(typeof definition.validate).toBe("function");
  });

  it("returns the same error the execution path returns, without writing", async () => {
    const { tools, service, byName } = buildTools(npcLimited);

    const executed: any = await tools.createEntity(
      { type: "npcs", fields: { name: "Marcus", tldr: "A guard." } },
      ctx as any,
      [],
    );
    const validated = await byName.get("create_entity")!.validate!({
      type: "npcs",
      fields: { name: "Marcus", tldr: "A guard." },
    });

    expect(validated).toBe(executed.error);
    expect(writeCalls(service)).toBe(0);
  });

  it("rejects an unwritable relationship on link and unlink before any approval", async () => {
    const { byName, service } = buildTools(npcLimited);
    const args = { type: "npcs", id: MARCUS, relationship: "related", targetIds: [ZOE] };

    await expect(byName.get("link_entities")!.validate!(args)).resolves.toBe(
      'Relationship "related" on npcs is not writable. Writable relationships: [scenes].',
    );
    await expect(byName.get("unlink_entities")!.validate!(args)).resolves.toBe(
      'Relationship "related" on npcs is not writable. Writable relationships: [scenes].',
    );
    expect(writeCalls(service)).toBe(0);
  });

  it("enforces the to-one link rules, which only the execution path used to catch", async () => {
    const { byName } = buildTools(npcLimited);

    await expect(
      byName.get("unlink_entities")!.validate!({
        type: "npcs",
        id: MARCUS,
        relationship: "campaign",
        targetIds: ["camp-1"],
      }),
    ).resolves.toBe('Relationship "campaign" on npcs cannot be changed.');
    await expect(
      byName.get("link_entities")!.validate!({ type: "npcs", id: MARCUS, relationship: "scenes", targetIds: [] }),
    ).resolves.toBe("targetIds must contain at least one id.");
  });

  it("rejects an out-of-scope id before the user is asked to approve anything", async () => {
    const catalog = {
      getAllChatEnabledEntities: () => [npcLimited],
      getEntityDetail: () => npcLimited,
    };
    const definitions = new EntityWriteTools(
      catalog as any,
      { get: () => ({ patch: vi.fn() }) } as any,
      { isInScope: async () => false } as any,
    ).buildDefinitions(ctx as any, []);
    const byName = new Map(definitions.map((definition) => [definition.tool.name, definition]));

    await expect(
      byName.get("update_entity")!.validate!({ type: "npcs", id: MARCUS, fields: { name: "x" } }),
    ).resolves.toMatch(/not found/i);
  });

  it("returns null and writes nothing for a valid call", async () => {
    const { byName, service } = buildTools(npcLimited);

    await expect(
      byName.get("create_entity")!.validate!({ type: "npcs", fields: { name: "Marcus" } }),
    ).resolves.toBeNull();
    await expect(
      byName.get("update_entity")!.validate!({ type: "npcs", id: MARCUS, fields: { description: "x" } }),
    ).resolves.toBeNull();
    await expect(byName.get("delete_entity")!.validate!({ type: "npcs", id: MARCUS })).resolves.toBeNull();
    await expect(
      byName.get("link_entities")!.validate!({ type: "npcs", id: MARCUS, relationship: "scenes", targetIds: [ZOE] }),
    ).resolves.toBeNull();
    expect(writeCalls(service)).toBe(0);
  });

  it("does not throw on args the model malformed — they are not zod-validated yet", async () => {
    const { byName } = buildTools(npcLimited);

    await expect(byName.get("create_entity")!.validate!({ type: "npcs" })).resolves.toBeNull();
    await expect(byName.get("link_entities")!.validate!({ type: "npcs" })).resolves.toMatch(/not available on npcs/);
  });
});

describe("EntityWriteTools", () => {
  it("builds no tools when no catalogued type is writable", () => {
    const catalog = { getAllChatEnabledEntities: () => [readOnly] };
    const tools = new EntityWriteTools(catalog as any, {} as any, {} as any).buildDefinitions(ctx as any, []);
    expect(tools).toEqual([]);
  });

  it("marks every write tool destructive and gives it a summary", () => {
    const catalog = { getAllChatEnabledEntities: () => [npc] };
    const definitions = new EntityWriteTools(catalog as any, {} as any, {} as any).buildDefinitions(ctx as any, []);

    expect(definitions.map((d) => d.tool.name).sort()).toEqual([
      "create_entity",
      "delete_entity",
      "link_entities",
      "unlink_entities",
      "update_entity",
    ]);
    for (const definition of definitions) {
      expect(definition.destructive).toBe(true);
      expect(typeof definition.summarise).toBe("function");
    }
  });

  it("injects the scope relationship on create so another campaign is unreachable", async () => {
    const createFromDTO = vi.fn().mockResolvedValue(undefined);
    const catalog = { getAllChatEnabledEntities: () => [npc], getEntityDetail: () => npc };
    const registry = { get: () => ({ createFromDTO }) };
    const tools = new EntityWriteTools(catalog as any, registry as any, { isInScope: async () => true } as any);

    await tools.createEntity(
      { type: "npcs", fields: { name: "New" }, relationships: { campaign: "camp-999" } },
      ctx as any,
      [],
    );

    expect(createFromDTO.mock.calls[0][0].data.relationships.campaign).toEqual({
      data: { type: "campaigns", id: "camp-1" },
    });
  });

  it("rejects a field that is not on the catalogued entity", async () => {
    const createFromDTO = vi.fn();
    const catalog = { getAllChatEnabledEntities: () => [npc], getEntityDetail: () => npc };
    const tools = new EntityWriteTools(
      catalog as any,
      { get: () => ({ createFromDTO }) } as any,
      {
        isInScope: async () => true,
      } as any,
    );

    const result: any = await tools.createEntity({ type: "npcs", fields: { nickname: "x" } }, ctx as any, []);

    expect(result.error).toMatch(/nickname/);
    expect(createFromDTO).not.toHaveBeenCalled();
  });

  it("refuses to update a record outside the scope", async () => {
    const patchFromDTO = vi.fn();
    const catalog = { getAllChatEnabledEntities: () => [npc], getEntityDetail: () => npc };
    const tools = new EntityWriteTools(
      catalog as any,
      { get: () => ({ patchFromDTO }) } as any,
      {
        isInScope: async () => false,
      } as any,
    );

    const result: any = await tools.updateEntity({ type: "npcs", id: "other", fields: { name: "x" } }, ctx as any, []);

    expect(result.error).toMatch(/not found/i);
    expect(patchFromDTO).not.toHaveBeenCalled();
  });

  describe("approval summaries name every referenced record", () => {
    it("gives every write tool a present hook alongside its summary", () => {
      const { definitions } = buildResolvingTools();
      for (const definition of definitions) {
        expect(typeof definition.summarise).toBe("function");
        expect(typeof definition.present).toBe("function");
      }
    });

    it("create names the new record from its own fields", async () => {
      const { byName } = buildResolvingTools();
      const summary = await byName.get("create_entity")!.summarise!({
        type: "npcs",
        fields: { name: "Marcus" },
      });
      expect(summary).toBe('Create a new npcs record named "Marcus".');
    });

    it("create without a name field falls back to the bare sentence", async () => {
      const { byName } = buildResolvingTools();
      const summary = await byName.get("create_entity")!.summarise!({ type: "npcs", fields: { description: "x" } });
      expect(summary).toBe("Create a new npcs record.");
    });

    it("update names the target record and lists the changed fields", async () => {
      const { byName } = buildResolvingTools();
      const summary = await byName.get("update_entity")!.summarise!({
        type: "npcs",
        id: MARCUS,
        fields: { description: "New notes.", tldr: "Guard." },
      });
      expect(summary).toBe('Update the npcs record "Marcus" (description, tldr).');
      expect(summary).not.toMatch(UUID_LIKE);
    });

    it("delete names the target record", async () => {
      const { byName } = buildResolvingTools();
      const summary = await byName.get("delete_entity")!.summarise!({ type: "npcs", id: MARCUS });
      expect(summary).toBe('Delete the npcs record "Marcus".');
      expect(summary).not.toMatch(UUID_LIKE);
    });

    it("link names both the target and every related record", async () => {
      const { byName } = buildResolvingTools();
      const summary = await byName.get("link_entities")!.summarise!({
        type: "npcs",
        id: MARCUS,
        relationship: "related",
        targetIds: [ZOE, BOB],
      });
      expect(summary).toBe('Link "Zoe", "Bob" to the "related" relationship of the npcs record "Marcus".');
      expect(summary).not.toMatch(UUID_LIKE);
    });

    it("unlink reads from, not to", async () => {
      const { byName } = buildResolvingTools();
      const summary = await byName.get("unlink_entities")!.summarise!({
        type: "npcs",
        id: MARCUS,
        relationship: "related",
        targetIds: [ZOE],
      });
      expect(summary).toBe('Unlink "Zoe" from the "related" relationship of the npcs record "Marcus".');
      expect(summary).not.toMatch(UUID_LIKE);
    });

    it("labels an id that does not exist (not found) rather than echoing it", async () => {
      const { byName } = buildResolvingTools();
      const summary = await byName.get("delete_entity")!.summarise!({ type: "npcs", id: GHOST });
      expect(summary).toBe("Delete the npcs record (not found).");
      expect(summary).not.toMatch(UUID_LIKE);
    });

    it("labels an out-of-scope id (not found) so no cross-scope name leaks", async () => {
      const { byName, findRecordById } = buildResolvingTools({ inScope: () => false });
      const summary = await byName.get("update_entity")!.summarise!({
        type: "npcs",
        id: MARCUS,
        fields: { name: "x" },
      });
      expect(summary).toBe("Update the npcs record (not found) (name).");
      expect(summary).not.toMatch(UUID_LIKE);
      // the record is never read: the scope guard rejects first
      expect(findRecordById).not.toHaveBeenCalled();
    });
  });

  describe("approval proposals resolve names and hide the scope", () => {
    it("create resolves relationships and strips the scope relationship", async () => {
      const { byName } = buildResolvingTools();
      const proposal = await byName.get("create_entity")!.present!({
        type: "npcs",
        fields: { name: "Marcus", description: "A guard." },
        relationships: { campaign: "camp-1", related: ZOE },
      });

      expect(proposal).toEqual({
        type: "npcs",
        attributes: { name: "Marcus", description: "A guard." },
        relationships: { related: [{ id: ZOE, type: "npcs", label: "Zoe" }] },
      });
    });

    it("create accepts an array of ids for one relationship", async () => {
      const { byName } = buildResolvingTools();
      const proposal: any = await byName.get("create_entity")!.present!({
        type: "npcs",
        fields: { name: "Marcus" },
        relationships: { related: [ZOE, BOB] },
      });

      expect(proposal.relationships.related).toEqual([
        { id: ZOE, type: "npcs", label: "Zoe" },
        { id: BOB, type: "npcs", label: "Bob" },
      ]);
    });

    it("create omits relationships entirely when only the scope was supplied", async () => {
      const { byName } = buildResolvingTools();
      const proposal: any = await byName.get("create_entity")!.present!({
        type: "npcs",
        fields: { name: "Marcus" },
        relationships: { campaign: "camp-1" },
      });

      expect(proposal).toEqual({ type: "npcs", attributes: { name: "Marcus" } });
    });

    it("update carries the resolved target and the raw attributes", async () => {
      const { byName } = buildResolvingTools();
      const proposal = await byName.get("update_entity")!.present!({
        type: "npcs",
        id: MARCUS,
        fields: { description: "New notes." },
      });

      expect(proposal).toEqual({
        type: "npcs",
        target: { id: MARCUS, type: "npcs", label: "Marcus" },
        attributes: { description: "New notes." },
      });
    });

    it("delete carries the resolved target only", async () => {
      const { byName } = buildResolvingTools();
      const proposal = await byName.get("delete_entity")!.present!({ type: "npcs", id: MARCUS });

      expect(proposal).toEqual({ type: "npcs", target: { id: MARCUS, type: "npcs", label: "Marcus" } });
    });

    it("link carries the relationship name and the resolved targets", async () => {
      const { byName } = buildResolvingTools();
      const proposal = await byName.get("link_entities")!.present!({
        type: "npcs",
        id: MARCUS,
        relationship: "related",
        targetIds: [ZOE, BOB],
      });

      expect(proposal).toEqual({
        type: "npcs",
        target: { id: MARCUS, type: "npcs", label: "Marcus" },
        relationship: "related",
        targets: [
          { id: ZOE, type: "npcs", label: "Zoe" },
          { id: BOB, type: "npcs", label: "Bob" },
        ],
      });
    });

    it("labels an unresolvable reference (not found) and keeps the id for keys only", async () => {
      const { byName } = buildResolvingTools();
      const proposal: any = await byName.get("link_entities")!.present!({
        type: "npcs",
        id: GHOST,
        relationship: "related",
        targetIds: [GHOST],
      });

      expect(proposal.target).toEqual({ id: GHOST, type: "npcs", label: "(not found)" });
      expect(proposal.targets).toEqual([{ id: GHOST, type: "npcs", label: "(not found)" }]);
    });

    it("prefers the catalog summary over the record name", async () => {
      const catalog = {
        getAllChatEnabledEntities: () => [npcRelated],
        getEntityDetail: () => ({ ...npcRelated, summary: (data: any) => `${data.name} the Guard` }),
      };
      const registry = { get: () => ({ findRecordById: async () => ({ id: MARCUS, name: "Marcus" }) }) };
      const definitions = new EntityWriteTools(
        catalog as any,
        registry as any,
        {
          isInScope: async () => true,
        } as any,
      ).buildDefinitions(ctx as any, []);
      const byName = new Map(definitions.map((definition) => [definition.tool.name, definition]));

      const summary = await byName.get("delete_entity")!.summarise!({ type: "npcs", id: MARCUS });
      expect(summary).toBe('Delete the npcs record "Marcus the Guard".');
    });

    it("never throws when the record read fails — the label degrades instead", async () => {
      const catalog = {
        getAllChatEnabledEntities: () => [npcRelated],
        getEntityDetail: () => npcRelated,
      };
      const registry = {
        get: () => ({
          findRecordById: async () => {
            throw new Error("neo4j down");
          },
        }),
      };
      const definitions = new EntityWriteTools(
        catalog as any,
        registry as any,
        {
          isInScope: async () => true,
        } as any,
      ).buildDefinitions(ctx as any, []);
      const byName = new Map(definitions.map((definition) => [definition.tool.name, definition]));

      await expect(byName.get("delete_entity")!.summarise!({ type: "npcs", id: MARCUS })).resolves.toBe(
        "Delete the npcs record (not found).",
      );
    });
  });
});

/**
 * A richtext field is READ as markdown (ToolFieldFormatterService renders the
 * stored BlockNote document), so the model writes markdown back. Storing that
 * prose verbatim leaves a record the frontend cannot render at all, so the write
 * path converts it to a BlockNote document. The approval card keeps the markdown.
 */
describe("EntityWriteTools — richtext fields", () => {
  const npcRichtext = {
    ...npc,
    fields: [
      { name: "name", type: "string", description: "Name.", filterable: true, sortable: true },
      {
        name: "description",
        type: "string",
        description: "Notes.",
        filterable: false,
        sortable: false,
        kind: { type: "richtext" },
      },
    ],
  } as any;

  function buildRichtextTools(options: { withConverter?: boolean } = {}) {
    const withConverter = options.withConverter ?? true;
    const service = {
      createFromDTO: vi.fn(async () => undefined),
      patchFromDTO: vi.fn(async () => undefined),
      findRecordById: vi.fn(async ({ id }: { id: string }) => ({ id, name: NAMES[id] ?? "Someone" })),
    };
    const catalog = {
      getAllChatEnabledEntities: () => [npcRichtext],
      getEntityDetail: (type: string) => (type === "npcs" ? npcRichtext : null),
    };
    const tools = new EntityWriteTools(
      catalog as any,
      { get: () => service } as any,
      { isInScope: async () => true } as any,
      undefined,
      withConverter ? new BlockNoteService() : undefined,
    );
    const byName = new Map(tools.buildDefinitions(ctx as any, []).map((d) => [d.tool.name, d]));
    return { tools, service, byName };
  }

  it("create converts the markdown of a richtext field into a stored BlockNote document", async () => {
    const { tools, service } = buildRichtextTools();
    await tools.createEntity(
      { type: "npcs", fields: { name: "Marcus", description: "# Title\n\nA paragraph." } },
      ctx as any,
      [],
    );

    const attributes = service.createFromDTO.mock.calls[0][0].data.attributes;
    const nodes = JSON.parse(attributes.description);
    expect(nodes.map((node: any) => node.type)).toEqual(["heading", "paragraph"]);
    // Not a richtext field: the markdown-looking name is stored verbatim.
    expect(attributes.name).toBe("Marcus");
  });

  it("update converts the markdown of a richtext field into a stored BlockNote document", async () => {
    const { tools, service } = buildRichtextTools();
    await tools.updateEntity(
      { type: "npcs", id: MARCUS, fields: { name: "# Marcus", description: "A paragraph." } },
      ctx as any,
      [],
    );

    const attributes = service.patchFromDTO.mock.calls[0][0].data.attributes;
    expect(JSON.parse(attributes.description)).toMatchObject([
      { type: "paragraph", content: [{ type: "text", text: "A paragraph." }] },
    ]);
    expect(attributes.name).toBe("# Marcus");
  });

  it("leaves a value that already is a stored BlockNote document untouched", async () => {
    const { tools, service } = buildRichtextTools();
    const document = JSON.stringify([
      { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text: "Stored.", styles: {} }], children: [] },
    ]);
    await tools.updateEntity({ type: "npcs", id: MARCUS, fields: { description: document } }, ctx as any, []);

    expect(service.patchFromDTO.mock.calls[0][0].data.attributes.description).toBe(document);
  });

  it("passes an empty richtext value through, so a field can still be cleared", async () => {
    const { tools, service } = buildRichtextTools();
    await tools.updateEntity({ type: "npcs", id: MARCUS, fields: { description: "" } }, ctx as any, []);

    expect(service.patchFromDTO.mock.calls[0][0].data.attributes.description).toBe("");
  });

  it("passes fields through unchanged when no converter is injected", async () => {
    const { tools, service } = buildRichtextTools({ withConverter: false });
    await tools.updateEntity({ type: "npcs", id: MARCUS, fields: { description: "# Title" } }, ctx as any, []);

    expect(service.patchFromDTO.mock.calls[0][0].data.attributes.description).toBe("# Title");
  });

  it("the create proposal keeps the model's markdown — the card renders text, not JSON", async () => {
    const { byName } = buildRichtextTools();
    const proposal: any = await byName.get("create_entity")!.present!({
      type: "npcs",
      fields: { name: "Marcus", description: "# Title\n\nA paragraph." },
    });

    expect(proposal.attributes.description).toBe("# Title\n\nA paragraph.");
  });

  it("the update proposal keeps the model's markdown", async () => {
    const { byName } = buildRichtextTools();
    const proposal: any = await byName.get("update_entity")!.present!({
      type: "npcs",
      id: MARCUS,
      fields: { description: "# Title\n\nA paragraph." },
    });

    expect(proposal.attributes.description).toBe("# Title\n\nA paragraph.");
  });

  it("tells the model that richtext fields take markdown", () => {
    const { byName } = buildRichtextTools();
    for (const name of ["create_entity", "update_entity"]) {
      expect(byName.get(name)!.tool.description).toContain(
        "Rich-text fields (kind richtext) take markdown; it is stored as a document.",
      );
    }
  });
});
