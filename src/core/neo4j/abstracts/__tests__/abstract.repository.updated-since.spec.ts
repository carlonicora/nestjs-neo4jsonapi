import { vi, describe, it, expect } from "vitest";
import { AbstractRepository } from "../abstract.repository";

class TraversalTestRepo extends AbstractRepository<any, any> {
  protected readonly descriptor: any;
  constructor(deps: any) {
    super(deps.neo4j, deps.securityService, {} as any);
    this.descriptor = deps.descriptor;
  }
}

const buildSut = () => {
  const capturedRef: any = { query: null };
  const neo4j = {
    initQuery: () => ({ query: "", queryParams: {} }),
    readMany: vi.fn(async (q: any) => {
      capturedRef.query = q;
      return [];
    }),
  };
  const securityService = { userHasAccess: () => "" };
  const descriptor = {
    model: { nodeName: "npc", type: "npcs", labelName: "Npc" },
    relationships: {
      campaign: {
        model: { nodeName: "campaign", labelName: "Campaign", type: "campaigns" },
        direction: "out",
        relationship: "BELONGS_TO",
        cardinality: "one",
      },
    },
    defaultOrderBy: "updatedAt DESC",
    isCompanyScoped: true,
  };
  const repo: any = new TraversalTestRepo({ neo4j, securityService, descriptor });
  repo.buildDefaultMatch = () => "MATCH (npc:Npc)";
  repo.buildReturnStatement = () => "RETURN npc";
  return { repo, capturedRef };
};

describe("AbstractRepository.findByRelated with updatedSince", () => {
  it("findByRelated with updatedSince adds the updatedAt > datetime($updatedSince) filter", async () => {
    const { repo, capturedRef } = buildSut();
    const updatedSince = "2026-10-31T10:00:00.000Z";

    await repo.findByRelated({ relationship: "campaign", id: "campaign-1", updatedSince });

    expect(capturedRef.query.query).toContain("WHERE npc.updatedAt > datetime($filter_0)");
    expect(capturedRef.query.queryParams).toMatchObject({ filter_0: updatedSince });
  });

  it("without it the Cypher is unchanged", async () => {
    const first = buildSut();
    await first.repo.findByRelated({ relationship: "campaign", id: "campaign-1" });
    const second = buildSut();
    await second.repo.findByRelated({ relationship: "campaign", id: "campaign-1", updatedSince: undefined });

    expect(first.capturedRef.query.query).not.toContain("updatedAt >");
    expect(first.capturedRef.query.query).not.toContain("datetime(");
    expect(second.capturedRef.query.query).toBe(first.capturedRef.query.query);
    expect(first.capturedRef.query.queryParams).not.toHaveProperty("filter_0");
  });

  it("keeps caller filters and appends updatedSince after them", async () => {
    const { repo, capturedRef } = buildSut();

    await repo.findByRelated({
      relationship: "campaign",
      id: "campaign-1",
      filters: [{ field: "status", op: "eq", value: "open" }],
      updatedSince: "2026-10-31T10:00:00.000Z",
    });

    expect(capturedRef.query.query).toContain("WHERE npc.status = $filter_0 AND npc.updatedAt > datetime($filter_1)");
  });
});
