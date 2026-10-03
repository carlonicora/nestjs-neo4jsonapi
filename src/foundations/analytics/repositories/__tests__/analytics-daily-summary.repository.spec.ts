import { int } from "neo4j-driver";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDailySummaryRepository } from "../analytics-daily-summary.repository";

const record = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] });

describe("AnalyticsDailySummaryRepository", () => {
  let repository: AnalyticsDailySummaryRepository;
  let neo4j: any;
  let written: Array<{ query: string; queryParams?: Record<string, unknown> }>;

  beforeEach(() => {
    written = [];
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
      writeOne: vi.fn(async (q: any) => {
        written.push({ query: q.query, queryParams: q.queryParams });
        return null;
      }),
      read: vi.fn(async () => ({ records: [] })),
      readOne: vi.fn(),
      readMany: vi.fn(async () => []),
    };
    const cls = { get: vi.fn(() => undefined), set: vi.fn() } as unknown as ClsService;
    const securityService = {
      userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
    } as any;

    repository = new AnalyticsDailySummaryRepository(neo4j, securityService, cls);
  });

  it("creates analyticsDailySummary_date_dimension index", async () => {
    await repository.onModuleInit();

    expect(written.map((w) => w.query)).toContain(
      "CREATE INDEX analyticsDailySummary_date_dimension IF NOT EXISTS FOR (analyticsDailySummary:AnalyticsDailySummary) ON (analyticsDailySummary.date, analyticsDailySummary.dimension)",
    );
  });

  it("rollupDay merges total and every dimension per section", async () => {
    neo4j.read
      .mockResolvedValueOnce({
        records: [
          record({
            section: "public",
            dimension: "total",
            key: "",
            visitors: int(5),
            sessions: int(6),
            pageViews: int(9),
          }),
          record({
            section: "public",
            dimension: "source",
            key: "linkedin",
            visitors: int(2),
            sessions: int(2),
            pageViews: int(4),
          }),
          record({
            section: "app",
            dimension: "landing",
            key: "/rolls",
            visitors: int(1),
            sessions: int(1),
            pageViews: int(3),
          }),
        ],
      })
      .mockResolvedValueOnce({
        records: [
          record({
            section: "app",
            dimension: "route",
            key: "/rolls/:id",
            visitors: int(1),
            sessions: int(1),
            pageViews: int(2),
          }),
        ],
      });

    const rows = await repository.rollupDay({ date: "2025-09-01" });

    expect(rows).toBe(4);

    // Sessions-based dimensions in one read, page-view-based in another.
    expect(neo4j.read).toHaveBeenCalledTimes(2);
    const [sessionQuery, sessionParams] = neo4j.read.mock.calls[0];
    const [pageViewQuery, pageViewParams] = neo4j.read.mock.calls[1];

    expect(sessionParams).toEqual({ date: "2025-09-01", noneKey: "(none)" });
    expect(pageViewParams).toEqual({ date: "2025-09-01" });
    expect(sessionQuery).toContain("date(analyticsSession.startedAt) = date($date)");
    expect(sessionQuery).toContain("count(DISTINCT analyticsSession.visitorId) AS visitors");
    for (const dimension of ["total", "source", "medium", "campaign", "referrer", "landing"]) {
      expect(sessionQuery).toContain(`'${dimension}'`);
    }
    expect(pageViewQuery).toContain(
      "MATCH (analyticsPageView:AnalyticsPageView)-[:IN_SESSION]->(analyticsSession:AnalyticsSession)",
    );
    expect(pageViewQuery).toContain("date(analyticsSession.startedAt) = date($date)");
    expect(pageViewQuery).toContain("'route'");
    expect(pageViewQuery).toContain("count(DISTINCT analyticsSession.visitorId) AS visitors");

    expect(written).toHaveLength(1);
    const { query, queryParams } = written[0];
    expect(query).toContain("UNWIND $rows AS row");
    expect(query).toContain("MERGE (analyticsDailySummary:AnalyticsDailySummary {id: row.id})");
    expect(query).toContain("analyticsDailySummary.date = date(left($date, 10))");
    expect(queryParams!.date).toBe("2025-09-01");
    expect(queryParams!.rows).toEqual([
      {
        id: "2025-09-01|public|total|",
        section: "public",
        dimension: "total",
        key: "",
        visitors: 5,
        sessions: 6,
        pageViews: 9,
      },
      {
        id: "2025-09-01|public|source|linkedin",
        section: "public",
        dimension: "source",
        key: "linkedin",
        visitors: 2,
        sessions: 2,
        pageViews: 4,
      },
      {
        id: "2025-09-01|app|landing|/rolls",
        section: "app",
        dimension: "landing",
        key: "/rolls",
        visitors: 1,
        sessions: 1,
        pageViews: 3,
      },
      {
        id: "2025-09-01|app|route|/rolls/:id",
        section: "app",
        dimension: "route",
        key: "/rolls/:id",
        visitors: 1,
        sessions: 1,
        pageViews: 2,
      },
    ]);
  });

  it("rollupDay writes sessions without a value under the '(none)' key instead of skipping them", async () => {
    neo4j.read
      .mockResolvedValueOnce({
        records: [
          record({
            section: "public",
            dimension: "total",
            key: "",
            visitors: int(1),
            sessions: int(1),
            pageViews: int(2),
          }),
          record({
            section: "public",
            dimension: "source",
            key: "(none)",
            visitors: int(1),
            sessions: int(1),
            pageViews: int(2),
          }),
        ],
      })
      .mockResolvedValueOnce({ records: [] });

    await expect(repository.rollupDay({ date: "2025-09-01" })).resolves.toBe(2);

    const [sessionQuery, sessionParams] = neo4j.read.mock.calls[0];
    for (const field of ["utmSource", "utmMedium", "utmCampaign", "referrerHost", "landingRoute"]) {
      expect(sessionQuery).toContain(`coalesce(analyticsSession.${field}, $noneKey)`);
    }
    expect(sessionQuery).not.toContain("'(none)'");
    expect(sessionParams).toEqual(expect.objectContaining({ noneKey: "(none)" }));
    expect(sessionQuery).not.toContain("WHERE key IS NOT NULL");

    expect(written[0].queryParams!.rows).toContainEqual({
      id: "2025-09-01|public|source|(none)",
      section: "public",
      dimension: "source",
      key: "(none)",
      visitors: 1,
      sessions: 1,
      pageViews: 2,
    });
  });

  it("rollupDay sets every property ON CREATE only, so a re-run never lowers an existing row", async () => {
    neo4j.read
      .mockResolvedValueOnce({
        records: [
          record({
            section: "public",
            dimension: "total",
            key: "",
            visitors: int(1),
            sessions: int(1),
            pageViews: int(1),
          }),
        ],
      })
      .mockResolvedValueOnce({ records: [] });

    await repository.rollupDay({ date: "2025-09-01" });

    const { query } = written[0];
    const afterMerge = query.slice(query.indexOf("MERGE ("));

    expect(afterMerge).toContain("ON CREATE SET");
    for (const field of ["visitors", "sessions", "pageViews"]) {
      expect(afterMerge).toContain(`analyticsDailySummary.${field} = row.${field}`);
    }
    expect(afterMerge).not.toContain("+=");
    expect(afterMerge).not.toContain("ON MATCH SET");
    // The ON CREATE SET is the only SET clause after the MERGE.
    expect(afterMerge.match(/\bSET\b/g)).toHaveLength(1);
  });

  it("rollupDay writes nothing for a day without data", async () => {
    await expect(repository.rollupDay({ date: "2025-09-01" })).resolves.toBe(0);
    expect(written).toHaveLength(0);
  });
});
