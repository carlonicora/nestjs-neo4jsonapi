import { describe, expect, it, vi } from "vitest";
import { AbstractRepository } from "../abstract.repository";

class TestRepo extends AbstractRepository<any, any> {
  protected readonly descriptor: any;

  constructor(deps: any) {
    super(deps.neo4j, deps.securityService, deps.clsService);
    this.descriptor = deps.descriptor;
  }
}

const buildSut = () => {
  const capturedRef: { query: { query: string; queryParams: Record<string, unknown> } | null } = { query: null };
  const neo4j = {
    bindsRequestContext: false,
    initQuery: () => ({ query: "", queryParams: {} }),
    readMany: vi.fn(async (q: any) => {
      capturedRef.query = q;
      return [];
    }),
  };
  const descriptor = {
    model: { nodeName: "n", type: "things", labelName: "Thing" },
    relationships: {
      owner: {
        model: { nodeName: "user", labelName: "User", type: "users" },
        direction: "in",
        relationship: "CREATED",
        cardinality: "one",
      },
    },
    defaultOrderBy: "updatedAt DESC",
    fulltextIndexName: "thing_fulltext",
    isCompanyScoped: true,
  };
  const repo: any = new TestRepo({
    neo4j,
    securityService: { userHasAccess: () => "" },
    clsService: { get: () => undefined },
    descriptor,
  });
  repo.buildDefaultMatch = () => "MATCH (n:Thing)";
  repo.buildReturnStatement = () => "RETURN n";
  const cypher = () => (capturedRef.query?.query ?? "").replace(/\s+/g, " ");
  return { repo, cypher };
};

describe("AbstractRepository list order (term + sort, id tiebreaker)", () => {
  it("find with term and orderByFields orders by the sort, then score, then id (call C7)", async () => {
    const { repo, cypher } = buildSut();
    await repo.find({ term: "acme", orderByFields: [{ field: "name", direction: "asc" }] });

    expect(cypher()).toContain(
      "ORDER BY CASE WHEN n.name IS :: STRING THEN toLower(n.name) ELSE n.name END ASC, score DESC, n.id ASC {CURSOR}",
    );
    expect(cypher()).not.toContain("ORDER BY score DESC");
  });

  it("find with a term and no sort keeps the relevance order unchanged", async () => {
    const { repo, cypher } = buildSut();
    await repo.find({ term: "acme" });

    expect(cypher()).toContain("ORDER BY score DESC {CURSOR}");
  });

  it("find without a term appends the id tiebreaker to the requested sort", async () => {
    const { repo, cypher } = buildSut();
    await repo.find({ orderByFields: [{ field: "name", direction: "desc" }] });

    expect(cypher()).toContain(
      "ORDER BY CASE WHEN n.name IS :: STRING THEN toLower(n.name) ELSE n.name END DESC, n.id ASC {CURSOR}",
    );
  });

  it("find without a term or sort appends the id tiebreaker to the descriptor default", async () => {
    const { repo, cypher } = buildSut();
    await repo.find({});

    expect(cypher()).toContain("ORDER BY n.updatedAt DESC, n.id ASC {CURSOR}");
  });

  it("findByRelated with term and orderByFields orders by the sort, then score, then id", async () => {
    const { repo, cypher } = buildSut();
    await repo.findByRelated({
      relationship: "owner",
      id: "u-1",
      term: "acme",
      orderByFields: [{ field: "createdAt", direction: "desc" }],
    });

    expect(cypher()).toContain("ORDER BY n.createdAt DESC, score DESC, n.id ASC {CURSOR}");
  });

  it("findByRelated with a term and no sort keeps the relevance order unchanged", async () => {
    const { repo, cypher } = buildSut();
    await repo.findByRelated({ relationship: "owner", id: "u-1", term: "acme" });

    expect(cypher()).toContain("ORDER BY score DESC {CURSOR}");
  });
});
