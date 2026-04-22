import { describe, it, expect, beforeEach, vi } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../abstract.repository";
import { Neo4jService } from "../../services/neo4j.service";
import { SecurityService } from "../../../security/services/security.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";

// Shared test host exposing the protected Cypher builder so we can assert its output
// against the three relationship shapes: non-polymorphic, phlow-style polymorphic
// (discriminatorRelationship), and multi-label polymorphic (no discriminatorRelationship).
type AnyDescriptor = EntityDescriptor<any, any>;

class HostRepository extends AbstractRepository<any, any> {
  protected readonly descriptor: AnyDescriptor;
  constructor(
    neo4j: Neo4jService,
    securityService: SecurityService,
    clsService: ClsService,
    descriptor: AnyDescriptor,
  ) {
    super(neo4j, securityService, clsService);
    this.descriptor = descriptor;
  }
  public buildReturn(): string {
    return this.buildReturnStatement();
  }
}

const model = (nodeName: string, labelName: string): DataModelInterface<any> => ({
  nodeName,
  labelName,
  jsonapiType: `${nodeName}s`,
  mapper: vi.fn(),
  attributes: {},
});

const mockNeo4j = () =>
  ({
    writeOne: vi.fn(),
    readOne: vi.fn(),
    readMany: vi.fn(),
    read: vi.fn(),
    initQuery: vi.fn(),
  }) as unknown as Neo4jService;

const mockSecurity = () =>
  ({
    userHasAccess: vi.fn((p: { validator: () => string }) => p.validator()),
  }) as unknown as SecurityService;

const mockCls = () =>
  ({
    has: vi.fn().mockReturnValue(true),
    get: vi.fn().mockReturnValue("cid"),
    set: vi.fn(),
  }) as unknown as ClsService;

const baseDescriptor = (relationships: Record<string, RelationshipDef>): AnyDescriptor => ({
  model: model("host", "Host"),
  isCompanyScoped: true,
  relationships,
  relationshipKeys: Object.fromEntries(Object.keys(relationships).map((k) => [k, k])) as any,
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
});

async function buildHost(descriptor: AnyDescriptor): Promise<HostRepository> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      {
        provide: HostRepository,
        useFactory: () => new HostRepository(mockNeo4j(), mockSecurity(), mockCls(), descriptor),
      },
    ],
  }).compile();
  return module.get(HostRepository);
}

describe("AbstractRepository.buildReturnStatement — relationship shapes", () => {
  describe("non-polymorphic MANY relationship (baseline)", () => {
    it("emits OPTIONAL MATCH with the target label constraint and no polymorphic markers", async () => {
      const descriptor = baseDescriptor({
        topics: {
          model: model("topic", "Topic"),
          direction: "out",
          relationship: "TAGGED_WITH",
          cardinality: "many",
          required: false,
        },
      });
      const repo = await buildHost(descriptor);

      const cypher = repo.buildReturn();

      // Label constraint stays on the target — preserves existing behavior
      expect(cypher).toContain("OPTIONAL MATCH (host)-[:TAGGED_WITH]->(host_topics:Topic)");
      // No polymorphic flags
      expect(cypher).not.toContain("host_topics_hasParent");
      expect(cypher).not.toContain("labels(host_topics)");
    });
  });

  describe("polymorphic with discriminatorRelationship (phlow-style taxonomy)", () => {
    it("emits OPTIONAL MATCH WITH the target label + EXISTS check for the discriminator edge", async () => {
      const taxMeta = model("taxonomy", "Taxonomy");
      const descriptor = baseDescriptor({
        taxonomy: {
          model: taxMeta,
          direction: "out",
          relationship: "REQUIRES",
          cardinality: "many",
          required: false,
          polymorphic: {
            candidates: [
              { nodeName: "taxonomy", labelName: "Taxonomy", jsonapiType: "taxonomies", type: "taxonomies" } as any,
              { nodeName: "leafTaxonomy", labelName: "Taxonomy", jsonapiType: "leaf-taxonomies", type: "leaf-taxonomies" } as any,
            ],
            discriminator: (d) => (d.hasParent ? (d.properties as any) : (d.properties as any)),
            discriminatorRelationship: "SPECIALISES",
            discriminatorDirection: "out",
          },
        },
      });
      const repo = await buildHost(descriptor);

      const cypher = repo.buildReturn();

      // Label constraint on the target is KEPT — taxonomy candidates share the `Taxonomy` label
      expect(cypher).toContain("OPTIONAL MATCH (host)-[:REQUIRES]->(host_taxonomy:Taxonomy)");
      // Existence check for the SPECIALISES edge is injected (phlow's discriminator flag)
      expect(cypher).toContain("EXISTS((host_taxonomy)-[:SPECIALISES]->()) AS host_taxonomy_hasParent");
      // Multi-label path markers MUST NOT appear on this shape
      expect(cypher).not.toContain("labels(host_taxonomy)");
      expect(cypher).not.toContain("$polyLabels");
    });
  });

  describe("polymorphic multi-label (AssistantMessage.references shape — NEW)", () => {
    it("emits OPTIONAL MATCH WITHOUT a target label and filters by labels(x) against a parameter", async () => {
      // In the live system the placeholder model is the message itself; we mirror that here.
      const placeholder = model("host", "Host");
      const descriptor = baseDescriptor({
        references: {
          model: placeholder,
          direction: "out",
          relationship: "REFERENCES",
          cardinality: "many",
          required: false,
          polymorphic: {
            candidates: [
              { nodeName: "order", labelName: "Order", jsonapiType: "orders", type: "orders" } as any,
              { nodeName: "account", labelName: "Account", jsonapiType: "accounts", type: "accounts" } as any,
              { nodeName: "person", labelName: "Person", jsonapiType: "persons", type: "persons" } as any,
            ],
            // No discriminatorRelationship — multi-label mode
            discriminator: (d) => d.properties as any,
          },
        },
      });
      const repo = await buildHost(descriptor);

      const cypher = repo.buildReturn();

      // Target has NO hardcoded label — match any label and filter via WHERE
      expect(cypher).toContain("OPTIONAL MATCH (host)-[:REFERENCES]->(host_references)");
      expect(cypher).not.toMatch(/OPTIONAL MATCH \(host\)-\[:REFERENCES\]->\(host_references:[A-Z]/);
      // Label filter predicate present on the polymorphic target, using a bound parameter
      expect(cypher).toContain("labels(host_references)");
      expect(cypher).toContain("$polyLabels_references");
      // Existing taxonomy-style marker MUST NOT leak into this shape
      expect(cypher).not.toContain("host_references_hasParent");
    });
  });
});
