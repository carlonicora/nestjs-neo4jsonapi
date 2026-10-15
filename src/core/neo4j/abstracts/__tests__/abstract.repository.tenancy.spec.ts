import { vi, describe, it, expect } from "vitest";
import { AbstractRepository } from "../abstract.repository";

class TestRepo extends AbstractRepository<any, any> {
  protected readonly descriptor: any;

  constructor(deps: any) {
    super(deps.neo4j, deps.securityService, deps.clsService);
    this.descriptor = deps.descriptor;
  }

  public defaultMatch(options?: { searchField?: string; blockCompanyAndUser?: boolean }): string {
    return this.buildDefaultMatch(options);
  }
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const viaDescriptor = {
  model: { nodeName: "message", type: "messages", labelName: "Message" },
  defaultOrderBy: "updatedAt DESC",
  fulltextIndexName: undefined,
  isCompanyScoped: false,
  tenancy: { via: "legalResearch" },
  relationships: {
    legalResearch: {
      model: { labelName: "LegalResearch" },
      direction: "in",
      relationship: "HAS_MESSAGE",
      cardinality: "one",
    },
  },
};

const buildSut = (descriptor: any, cls: Record<string, string | undefined> = { companyId: "c-1", userId: "u-1" }) => {
  const captured: any[] = [];
  const clsService = {
    get: (key: string) => cls[key],
    has: (key: string) => cls[key] !== undefined,
  };
  const neo4j = {
    initQuery: () => ({
      query: "",
      queryParams: { companyId: cls.companyId ?? null, currentUserId: cls.userId ?? null },
    }),
    readMany: vi.fn(async (q: any) => {
      captured.push(q);
      return [];
    }),
    readOne: vi.fn(async (q: any) => {
      captured.push(q);
      return { id: "x" };
    }),
  };
  const securityService = { userHasAccess: () => "" };
  const repo = new TestRepo({ neo4j, securityService, clsService, descriptor });
  (repo as any).buildReturnStatement = () => "RETURN node";
  return { repo, captured };
};

describe("AbstractRepository.buildDefaultMatch — tenancy", () => {
  it("emits the via predicate", () => {
    const { repo } = buildSut(viaDescriptor);
    const cypher = squash(repo.defaultMatch());
    expect(cypher).toContain("MATCH (message:Message)");
    expect(cypher).toContain(
      "WHERE $companyId IS NULL OR EXISTS { MATCH (message)<-[:HAS_MESSAGE]-(:LegalResearch)-[:BELONGS_TO]->(company) }",
    );
    expect(cypher).toContain("WITH message, company, currentUser");
  });

  it("emits the via predicate with an outgoing arrow for direction out", () => {
    const { repo } = buildSut({
      ...viaDescriptor,
      relationships: {
        legalResearch: { ...viaDescriptor.relationships.legalResearch, direction: "out" },
      },
    });
    expect(squash(repo.defaultMatch())).toContain(
      "EXISTS { MATCH (message)-[:HAS_MESSAGE]->(:LegalResearch)-[:BELONGS_TO]->(company) }",
    );
  });

  it("emits the direct company predicate for a via to the self target", () => {
    const invitationDescriptor = {
      model: { nodeName: "invitation", type: "invitations", labelName: "Invitation" },
      isCompanyScoped: false,
      tenancy: { via: "company" },
      relationships: {
        company: {
          model: { labelName: "Company" },
          direction: "in",
          relationship: "HAS_INVITATION",
          cardinality: "one",
        },
      },
    };
    const inCypher = squash(buildSut(invitationDescriptor).repo.defaultMatch());
    expect(inCypher).toContain(
      "WHERE $companyId IS NULL OR EXISTS { MATCH (invitation)<-[:HAS_INVITATION]-(company) }",
    );
    expect(inCypher).not.toContain("BELONGS_TO");
    expect(inCypher).toMatch(/WITH invitation, company, currentUser$/);

    const outCypher = squash(
      buildSut({
        ...invitationDescriptor,
        relationships: {
          company: { ...invitationDescriptor.relationships.company, direction: "out", relationship: "FOR_COMPANY" },
        },
      }).repo.defaultMatch(),
    );
    expect(outCypher).toContain("EXISTS { MATCH (invitation)-[:FOR_COMPANY]->(company) }");
    expect(outCypher).not.toContain("BELONGS_TO");
  });

  it("emits the self predicate", () => {
    const { repo } = buildSut({
      model: { nodeName: "company", type: "companies", labelName: "Company" },
      isCompanyScoped: false,
      tenancy: "self",
      relationships: {},
    });
    const cypher = squash(repo.defaultMatch({ searchField: "id" }));
    expect(cypher).toContain("MATCH (company:Company {id: $searchValue})");
    expect(cypher).toContain("WHERE $companyId IS NULL OR company.id = $companyId");
    expect(cypher).toMatch(/WITH company, currentUser$/);
  });

  it("emits no predicate for global", () => {
    const { repo } = buildSut({
      model: { nodeName: "law", type: "laws", labelName: "Law" },
      isCompanyScoped: false,
      tenancy: "global",
      relationships: {},
    });
    const cypher = squash(repo.defaultMatch());
    expect(cypher).toBe("MATCH (law:Law) WITH law");
  });

  it("omits company and currentUser from the WITH tail when CLS has none", () => {
    const { repo } = buildSut(viaDescriptor, {});
    const cypher = squash(repo.defaultMatch());
    expect(cypher).toContain("$companyId IS NULL OR EXISTS");
    expect(cypher).toMatch(/WITH message$/);
  });

  it("find() and findById() carry the via predicate and the CLS companyId", async () => {
    const { repo, captured } = buildSut(viaDescriptor);
    await repo.find({});
    await repo.findById({ id: "m-1" });
    for (const q of captured) {
      expect(squash(q.query)).toContain(
        "EXISTS { MATCH (message)<-[:HAS_MESSAGE]-(:LegalResearch)-[:BELONGS_TO]->(company) }",
      );
      expect(q.queryParams.companyId).toBe("c-1");
    }
    expect(captured).toHaveLength(2);
  });
});
