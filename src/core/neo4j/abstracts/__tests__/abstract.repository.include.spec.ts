import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbstractRepository } from "../abstract.repository";
import { Neo4jService } from "../../services/neo4j.service";
import { SecurityService } from "../../../security/services/security.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";
import { modelRegistry } from "../../../../common/registries/registry";
import { ClsService } from "nestjs-cls";

interface RoundE {
  id: string;
}
type RoundRels = { turns: RelationshipDef };

const turnModel = (): DataModelInterface<any> => ({
  type: "turns",
  endpoint: "turns",
  nodeName: "turn",
  labelName: "Turn",
  entity: undefined as any,
  mapper: vi.fn(),
  singleChildrenRelationships: [
    {
      nodeName: "npc",
      relationshipName: "npc",
      direction: "out",
      relationship: "PLAYED_BY",
      cardinality: "one",
      required: false,
    },
    {
      nodeName: "user",
      relationshipName: "user",
      direction: "out",
      relationship: "PLAYED_BY",
      cardinality: "one",
      required: false,
    },
  ],
  childrenRelationships: [],
});
const npcModel = (): DataModelInterface<any> => ({
  type: "npcs",
  endpoint: "npcs",
  nodeName: "npc",
  labelName: "Npc",
  entity: undefined as any,
  mapper: vi.fn(),
  singleChildrenRelationships: [
    {
      nodeName: "faction",
      relationshipName: "faction",
      direction: "out",
      relationship: "MEMBER_OF",
      cardinality: "one",
      required: false,
    },
  ],
  childrenRelationships: [],
});
const factionModel = (): DataModelInterface<any> => ({
  type: "factions",
  endpoint: "factions",
  nodeName: "faction",
  labelName: "Faction",
  entity: undefined as any,
  mapper: vi.fn(),
  singleChildrenRelationships: [],
  childrenRelationships: [],
});
const userModel = (): DataModelInterface<any> => ({
  type: "users",
  endpoint: "users",
  nodeName: "user",
  labelName: "User",
  entity: undefined as any,
  mapper: vi.fn(),
  singleChildrenRelationships: [],
  childrenRelationships: [],
});

const roundDescriptor = (include?: string[]): EntityDescriptor<RoundE, RoundRels> => ({
  model: {
    type: "rounds",
    endpoint: "rounds",
    nodeName: "round",
    labelName: "Round",
    entity: undefined as any,
    mapper: vi.fn(),
  },
  isCompanyScoped: false,
  relationships: {
    turns: {
      model: { type: "turns", endpoint: "turns", nodeName: "turn", labelName: "Turn" },
      direction: "in",
      relationship: "PART_OF",
      cardinality: "many",
      required: false,
      include,
    },
  },
  relationshipKeys: { turns: "turns" },
  fieldNames: [],
  stringFields: [],
  requiredFields: [],
  fieldDefaults: {},
  fields: {},
  computed: {},
  virtualFields: {},
  injectServices: [],
  constraints: [{ property: "id", type: "UNIQUE" }],
  indexes: [],
  fulltextIndexName: "",
  defaultOrderBy: "updatedAt DESC",
});

class RoundRepo extends AbstractRepository<RoundE, RoundRels> {
  protected readonly descriptor: EntityDescriptor<RoundE, RoundRels>;
  constructor(include?: string[]) {
    super({} as Neo4jService, {} as SecurityService, {} as ClsService);
    this.descriptor = roundDescriptor(include);
  }
  public exposedBuildReturnStatement(): string {
    return this.buildReturnStatement();
  }
}

beforeEach(() => {
  for (const m of [turnModel(), npcModel(), factionModel(), userModel()]) modelRegistry.register(m);
});

describe("buildReturnStatement — nested include", () => {
  it("emits a nested OPTIONAL MATCH and column for a single include segment", () => {
    const cypher = new RoundRepo(["npc"]).exposedBuildReturnStatement();
    expect(cypher).toContain("OPTIONAL MATCH (round_turns)-[:PLAYED_BY]->(round_turns_npc:Npc)");
    expect(cypher).toMatch(/RETURN[^]*round_turns_npc/);
  });

  it("emits each segment of a multi-level path with correct labels", () => {
    const cypher = new RoundRepo(["npc.faction"]).exposedBuildReturnStatement();
    expect(cypher).toContain("OPTIONAL MATCH (round_turns)-[:PLAYED_BY]->(round_turns_npc:Npc)");
    expect(cypher).toContain("OPTIONAL MATCH (round_turns_npc)-[:MEMBER_OF]->(round_turns_npc_faction:Faction)");
    expect(cypher).toMatch(/RETURN[^]*round_turns_npc_faction/);
  });

  it("deduplicates a shared path prefix without dropping the deeper segment", () => {
    const cypher = new RoundRepo(["npc.faction", "npc"]).exposedBuildReturnStatement();
    const occurrences = cypher.split("OPTIONAL MATCH (round_turns)-[:PLAYED_BY]->(round_turns_npc:Npc)").length - 1;
    expect(occurrences).toBe(1);
    expect(cypher).toContain("OPTIONAL MATCH (round_turns_npc)-[:MEMBER_OF]->(round_turns_npc_faction:Faction)");
  });

  it("throws when an include segment cannot be resolved", () => {
    expect(() => new RoundRepo(["nonexistent"]).exposedBuildReturnStatement()).toThrow(
      /relationship "nonexistent" not found/,
    );
  });

  it("is byte-identical to the no-include output when include is absent (regression)", () => {
    const withUndefined = new RoundRepo(undefined).exposedBuildReturnStatement();
    const withEmpty = new RoundRepo([]).exposedBuildReturnStatement();
    expect(withUndefined).toBe(withEmpty);
    expect(withUndefined).not.toContain("round_turns_npc");
  });
});
