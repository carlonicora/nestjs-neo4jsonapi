import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../abstract.repository";
import { Neo4jService } from "../../services/neo4j.service";
import { SecurityService } from "../../../security/services/security.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";
import { modelRegistry } from "../../../../common/registries/registry";
import { EntityFactory } from "../../factories/entity.factory";
import { TokenResolverService } from "../../services/token-resolver.service";

// `externalSource: true` on a relationship: generic reads return the related node as
// `{ labels, properties: { id } }` only, never its stored properties. Default unchanged.

type AnyDescriptor = EntityDescriptor<any, any>;

class HostRepository extends AbstractRepository<any, any> {
  protected readonly descriptor: AnyDescriptor;
  constructor(descriptor: AnyDescriptor) {
    super(
      { initQuery: vi.fn(), readOne: vi.fn(), readMany: vi.fn(), writeOne: vi.fn() } as unknown as Neo4jService,
      { userHasAccess: vi.fn() } as unknown as SecurityService,
      { has: vi.fn(), get: vi.fn() } as unknown as ClsService,
    );
    this.descriptor = descriptor;
  }
  public buildReturn(): string {
    return this.buildReturnStatement();
  }
}

const model = (nodeName: string, labelName: string): DataModelInterface<any> => ({
  type: `${nodeName}s`,
  endpoint: `${nodeName}s`,
  nodeName,
  labelName,
  entity: undefined as any,
  mapper: vi.fn(),
});

const descriptorWith = (relationships: Record<string, RelationshipDef>): AnyDescriptor =>
  ({
    model: model("host", "Host"),
    isCompanyScoped: false,
    relationships,
    relationshipKeys: Object.fromEntries(Object.keys(relationships).map((k) => [k, k])),
    fieldNames: [],
    stringFields: [],
    requiredFields: [],
    fieldDefaults: {},
    fields: {},
    computed: {},
    virtualFields: {},
    injectServices: [],
    constraints: [],
    indexes: [],
    fulltextIndexName: "",
    defaultOrderBy: "",
  }) as unknown as AnyDescriptor;

const idOnly = (alias: string) =>
  `CASE WHEN ${alias} IS NULL THEN NULL ELSE { labels: labels(${alias}), properties: { id: ${alias}.id } } END`;

const lawRel = (overrides: Partial<RelationshipDef> = {}): RelationshipDef => ({
  model: model("law", "Law"),
  direction: "out",
  relationship: "REFERENCES_LAW",
  cardinality: "many",
  required: false,
  ...overrides,
});

describe("AbstractRepository.buildReturnStatement — externalSource", () => {
  describe("default (option absent): unchanged", () => {
    it("returns the related node itself for a relationship without edge fields", () => {
      const cypher = new HostRepository(descriptorWith({ law: lawRel() })).buildReturn();
      expect(cypher).toContain("OPTIONAL MATCH (host)-[:REFERENCES_LAW]->(host_law:Law)");
      expect(cypher).toBe("OPTIONAL MATCH (host)-[:REFERENCES_LAW]->(host_law:Law)\nRETURN host, host_law");
      expect(cypher).not.toContain("properties: { id:");
    });

    it("collects the related node itself for a MANY relationship with edge fields", () => {
      const cypher = new HostRepository(
        descriptorWith({ law: lawRel({ fields: [{ name: "relevance", type: "number" }] }) }),
      ).buildReturn();
      expect(cypher).toContain("COLLECT(DISTINCT host_law) AS host_laws");
      expect(cypher).not.toContain("properties: { id:");
    });
  });

  describe("opt-in (externalSource: true): id + labels only", () => {
    it("projects a MANY relationship without edge fields as an id-only node map", () => {
      const cypher = new HostRepository(descriptorWith({ law: lawRel({ externalSource: true }) })).buildReturn();
      expect(cypher).toContain("OPTIONAL MATCH (host)-[:REFERENCES_LAW]->(host_law:Law)");
      expect(cypher).toContain(`RETURN host, ${idOnly("host_law")} AS host_law`);
      expect(cypher).not.toMatch(/RETURN[^\n]*,\s*host_law(,|$)/);
    });

    it("projects a ONE relationship with edge fields as an id-only node map and keeps the edge columns", () => {
      const cypher = new HostRepository(
        descriptorWith({
          judgement: {
            model: model("judgement", "Judgement"),
            direction: "out",
            relationship: "REFERS_TO",
            cardinality: "one",
            required: false,
            fields: [{ name: "reason", type: "string" }],
            externalSource: true,
          },
        }),
      ).buildReturn();
      expect(cypher).toContain(`${idOnly("host_judgement")} AS host_judgement`);
      expect(cypher).toContain("host_judgement_relationship.reason AS host_judgement_relationship_reason");
    });

    it("collects id-only node maps for a MANY relationship with edge fields; edge props still keyed by id", () => {
      const cypher = new HostRepository(
        descriptorWith({ law: lawRel({ fields: [{ name: "relevance", type: "number" }], externalSource: true }) }),
      ).buildReturn();
      expect(cypher).toContain(`COLLECT(DISTINCT ${idOnly("host_law")}) AS host_laws`);
      expect(cypher).not.toContain("COLLECT(DISTINCT host_law) AS");
      expect(cypher).toContain("{ nodeId: host_law.id, edgeProps: {relevance: host_law_relationship.relevance} }");
      expect(cypher).toContain("UNWIND CASE WHEN size(host_laws) > 0 THEN host_laws ELSE [null] END AS host_law");
    });

    it("keeps the multi-label polymorphic filter and projects the matched node id-only", () => {
      const cypher = new HostRepository(
        descriptorWith({
          law: lawRel({
            externalSource: true,
            polymorphic: {
              candidates: [model("law", "Law"), model("lawArticle", "LawArticle")],
              discriminator: vi.fn(),
            },
          }),
        }),
      ).buildReturn();
      expect(cypher).toContain("OPTIONAL MATCH (host)-[:REFERENCES_LAW]->(host_law)");
      expect(cypher).toContain("WHERE host_law IS NULL OR any(l IN labels(host_law) WHERE l IN $polyLabels_law)");
      expect(cypher).toContain(`${idOnly("host_law")} AS host_law`);
    });

    it("leaves sibling relationships without the option untouched", () => {
      const cypher = new HostRepository(
        descriptorWith({
          law: lawRel({ externalSource: true }),
          topic: { model: model("topic", "Topic"), direction: "out", relationship: "TAGGED", cardinality: "many" },
        }),
      ).buildReturn();
      expect(cypher).toContain(`RETURN host, ${idOnly("host_law")} AS host_law, host_topic`);
    });
  });

  describe("nested include into an externalSource relationship", () => {
    beforeEach(() => {
      (modelRegistry as any).models = new Map();
      (modelRegistry as any).labelNameIndex = new Map();
      (modelRegistry as any).typeIndex = new Map();
      modelRegistry.register({
        ...model("doc", "Doc"),
        singleChildrenRelationships: [
          {
            nodeName: "law",
            relationshipName: "law",
            direction: "out",
            relationship: "CITES_LAW",
            cardinality: "one",
            externalSource: true,
          },
        ],
        childrenRelationships: [],
      });
      modelRegistry.register({ ...model("law", "Law"), singleChildrenRelationships: [], childrenRelationships: [] });
    });

    it("projects the included external node id-only", () => {
      const cypher = new HostRepository(
        descriptorWith({
          doc: {
            model: model("doc", "Doc"),
            direction: "out",
            relationship: "HAS_DOC",
            cardinality: "many",
            include: ["law"],
          },
        }),
      ).buildReturn();
      expect(cypher).toContain("OPTIONAL MATCH (host_doc)-[:CITES_LAW]->(host_doc_law:Law)");
      expect(cypher).toContain(`${idOnly("host_doc_law")} AS host_doc_law`);
    });

    it("refuses to expand past an external node", () => {
      const repo = new HostRepository(
        descriptorWith({
          doc: {
            model: model("doc", "Doc"),
            direction: "out",
            relationship: "HAS_DOC",
            cardinality: "many",
            include: ["law.anything"],
          },
        }),
      );
      expect(() => repo.buildReturn()).toThrow(/externalSource/);
    });
  });
});

describe("EntityFactory maps the id-only projection to an id-only related entity", () => {
  it("never carries a stored property of the related node", () => {
    (modelRegistry as any).models = new Map();
    (modelRegistry as any).labelNameIndex = new Map();
    (modelRegistry as any).typeIndex = new Map();
    const lawModel: DataModelInterface<any> = {
      ...model("law", "Law"),
      mapper: vi.fn((params: { data: any }) => ({
        id: params.data.id,
        name: params.data.name,
        labels: params.data.labels,
      })),
    };
    modelRegistry.register(lawModel);
    const hostModel: DataModelInterface<any> = {
      ...model("host", "Host"),
      mapper: vi.fn((params: { data: any }) => ({ id: params.data.id, law: [] })),
      childrenRelationships: [{ nodeName: "law", relationshipName: "law" }],
      singleChildrenRelationships: [],
    };
    // Shape the opt-in RETURN produces for `host_law`.
    const cols: Record<string, unknown> = {
      host: { labels: ["Host"], properties: { id: "h1" } },
      host_law: { labels: ["Law", "CorpusRef"], properties: { id: "l1" } },
    };
    const record = { keys: Object.keys(cols), has: (k: string) => k in cols, get: (k: string) => cols[k] };

    const [host] = new EntityFactory(new TokenResolverService()).createGraphList({
      model: hostModel,
      records: [record as any],
    });

    expect(host.law).toEqual([{ id: "l1", name: undefined, labels: ["Law", "CorpusRef"] }]);
  });
});
