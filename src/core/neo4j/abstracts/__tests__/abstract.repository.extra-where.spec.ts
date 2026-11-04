import { describe, expect, it, vi } from "vitest";
import { AbstractRepository } from "../abstract.repository";

class TestRepo extends AbstractRepository<any, any> {
  protected readonly descriptor: any;

  constructor(deps: any) {
    super(deps.neo4j, deps.securityService, { get: () => undefined } as any);
    this.descriptor = deps.descriptor;
  }
}

const buildSut = (overrides: { fulltextIndexName?: string } = {}) => {
  const captured: { query: { query: string; queryParams: Record<string, unknown> } | null } = { query: null };
  const neo4j = {
    initQuery: () => ({ query: "", queryParams: {} }),
    readMany: vi.fn(async (q: any) => {
      captured.query = q;
      return [];
    }),
  };
  const securityService = { userHasAccess: () => "" };
  const descriptor = {
    model: { nodeName: "x", type: "xs", labelName: "X" },
    relationships: {
      campaign: {
        model: { nodeName: "campaign", labelName: "Campaign", type: "campaigns" },
        direction: "out",
        relationship: "BELONGS_TO",
        cardinality: "one",
      },
    },
    defaultOrderBy: "updatedAt DESC",
    fulltextIndexName: overrides.fulltextIndexName,
    isCompanyScoped: true,
  };
  const repo: any = new TestRepo({ neo4j, securityService, descriptor });
  repo.buildDefaultMatch = () => "MATCH (x:X)";
  repo.buildReturnStatement = () => "RETURN x";
  return { repo, captured };
};

const extraWhere = { clause: "x.flag = $extraFlag", params: { extraFlag: true } };

describe("AbstractRepository.findByRelated with extraWhere", () => {
  it("default branch: AND-s extraWhere with filters and merges its params", async () => {
    const { repo, captured } = buildSut();

    await repo.findByRelated({
      relationship: "campaign",
      id: "c-1",
      filters: [{ field: "clueType", op: "eq", value: "clue" }],
      extraWhere,
    });

    const text = captured.query!.query;
    expect(text).toContain("WHERE x.clueType = $filter_0 AND (x.flag = $extraFlag)");
    expect(captured.query!.queryParams.extraFlag).toBe(true);
    expect(text.indexOf("(x.flag = $extraFlag)")).toBeLessThan(text.indexOf("{CURSOR}"));
  });

  it("default branch: extraWhere alone produces a WHERE", async () => {
    const { repo, captured } = buildSut();

    await repo.findByRelated({ relationship: "campaign", id: "c-1", extraWhere });

    expect(captured.query!.query).toContain("WHERE (x.flag = $extraFlag)");
    expect(captured.query!.queryParams.extraFlag).toBe(true);
  });

  it("full-text branch: extraWhere reaches the post-hit WHERE", async () => {
    const { repo, captured } = buildSut({ fulltextIndexName: "idx" });

    await repo.findByRelated({ relationship: "campaign", id: "c-1", term: "foo", extraWhere });

    const text = captured.query!.query;
    const fulltextAt = text.indexOf("CALL db.index.fulltext.queryNodes");
    const clauseAt = text.indexOf("WHERE (x.flag = $extraFlag)");
    const orderAt = text.indexOf("ORDER BY score DESC");
    expect(fulltextAt).toBeGreaterThanOrEqual(0);
    expect(clauseAt).toBeGreaterThan(fulltextAt);
    expect(orderAt).toBeGreaterThan(clauseAt);
    expect(captured.query!.queryParams.extraFlag).toBe(true);
  });

  it("omitted extraWhere builds the same query as before", async () => {
    const without = buildSut();
    await without.repo.findByRelated({
      relationship: "campaign",
      id: "c-1",
      filters: [{ field: "clueType", op: "eq", value: "clue" }],
    });

    const withUndefined = buildSut();
    await withUndefined.repo.findByRelated({
      relationship: "campaign",
      id: "c-1",
      filters: [{ field: "clueType", op: "eq", value: "clue" }],
      extraWhere: undefined,
    });

    expect(withUndefined.captured.query!.query).toBe(without.captured.query!.query);
    expect(withUndefined.captured.query!.queryParams).toEqual(without.captured.query!.queryParams);
  });
});
