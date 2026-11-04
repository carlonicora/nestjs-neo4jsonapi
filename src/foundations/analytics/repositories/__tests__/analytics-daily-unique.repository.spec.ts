import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi, type Mocked } from "vitest";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { AnalyticsDailyUniqueRepository } from "../analytics-daily-unique.repository";

describe("AnalyticsDailyUniqueRepository", () => {
  let repository: AnalyticsDailyUniqueRepository;
  let neo4j: Mocked<Pick<Neo4jService, "initQuery" | "writeOne" | "read" | "readOne" | "readMany">>;
  let written: Array<{ query: string; queryParams?: Record<string, unknown> }>;

  beforeEach(() => {
    written = [];
    neo4j = {
      initQuery: vi.fn().mockImplementation(() => ({ query: "", queryParams: {} })),
      writeOne: vi.fn().mockImplementation(async (q: { query: string; queryParams?: Record<string, unknown> }) => {
        written.push({ query: q.query, queryParams: q.queryParams });
        return null;
      }),
      read: vi.fn().mockResolvedValue({ records: [] }),
      readOne: vi.fn().mockResolvedValue(null),
      readMany: vi.fn().mockResolvedValue([]),
    };
    const cls = { get: vi.fn(() => undefined), set: vi.fn() } as unknown as ClsService;
    const securityService = {
      userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
    } as unknown as SecurityService;

    repository = new AnalyticsDailyUniqueRepository(neo4j as unknown as Neo4jService, securityService, cls);
  });

  it("creates the analyticsDailyUnique_date index", async () => {
    await repository.onModuleInit();

    expect(written.map((w) => w.query)).toContain(
      "CREATE INDEX analyticsDailyUnique_date IF NOT EXISTS FOR (analyticsDailyUnique:AnalyticsDailyUnique) ON (analyticsDailyUnique.date)",
    );
  });

  it("rollupDay sends one write query bound to the date, seeded with the descriptor serialiser", async () => {
    await repository.rollupDay({ date: "2026-10-05" });

    expect(neo4j.initQuery).toHaveBeenCalledWith(expect.objectContaining({ serialiser: expect.anything() }));
    expect(neo4j.read).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    expect(written[0].queryParams!.date).toBe("2026-10-05");
  });

  it("rollupDay counts distinct visitors and linked users of the day's sessions, with no section predicate", async () => {
    await repository.rollupDay({ date: "2026-10-05" });

    const { query } = written[0];
    expect(query).toContain("MATCH (analyticsSession:AnalyticsSession)");
    expect(query).toContain("date(analyticsSession.startedAt) = date($date)");
    expect(query).toContain("OPTIONAL MATCH (analyticsSession)-[:BY_USER]->(user:User)");
    expect(query).toContain("count(DISTINCT analyticsSession.visitorId) AS visitors");
    expect(query).toContain("count(DISTINCT user) AS users");
    expect(query).not.toContain("section");
  });

  it("rollupDay merges on the date id and sets every property ON CREATE only", async () => {
    await repository.rollupDay({ date: "2026-10-05" });

    const { query } = written[0];
    expect(query).toContain("MERGE (analyticsDailyUnique:AnalyticsDailyUnique {id: $date})");

    const afterMerge = query.slice(query.indexOf("MERGE ("));
    expect(afterMerge).toContain("ON CREATE SET");
    expect(afterMerge).toContain("analyticsDailyUnique.date = date(left($date, 10))");
    expect(afterMerge).toContain("analyticsDailyUnique.visitors = visitors");
    expect(afterMerge).toContain("analyticsDailyUnique.users = users");
    expect(afterMerge).not.toContain("ON MATCH SET");
    expect(afterMerge).not.toContain("+=");
    // The ON CREATE SET is the only SET clause after the MERGE.
    expect(afterMerge.match(/\bSET\b/g)).toHaveLength(1);
  });

  it("rollupDay writes nothing for a day without sessions", async () => {
    await repository.rollupDay({ date: "2026-10-05" });

    const { query } = written[0];
    const guard = query.indexOf("WHERE sessions > 0");
    expect(query).toContain("count(DISTINCT analyticsSession) AS sessions");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(query.indexOf("MERGE ("));
  });
});
