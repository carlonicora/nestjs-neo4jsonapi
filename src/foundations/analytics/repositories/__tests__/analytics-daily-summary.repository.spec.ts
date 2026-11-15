import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { audienceOf } from "../analytics-audience.cypher";
import { AnalyticsDailySummaryRepository } from "../analytics-daily-summary.repository";

type ScalarRow = Record<string, unknown>;

const row = (values: Partial<ScalarRow> & { audience: string; dimension: string; key: string }): ScalarRow => ({
  visitorIds: 0,
  users: 0,
  sessions: 0,
  pageViews: 0,
  ...values,
});

describe("AnalyticsDailySummaryRepository", () => {
  let repository: AnalyticsDailySummaryRepository;
  let neo4j: any;
  let written: Array<{ query: string; queryParams?: Record<string, unknown> }>;
  /** One result list per readScalars call, in call order (sessions, page views, exit). */
  let scalarResults: ScalarRow[][];

  beforeEach(() => {
    written = [];
    scalarResults = [];
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
      writeOne: vi.fn(async (q: any) => {
        written.push({ query: q.query, queryParams: q.queryParams });
        return null;
      }),
      read: vi.fn(async () => ({ records: [] })),
      readScalars: vi.fn(async (params: { map: (r: any) => unknown }) => (scalarResults.shift() ?? []).map(params.map)),
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

  it("groups every session dimension by audience", async () => {
    scalarResults = [
      [
        row({ audience: "visitors", dimension: "total", key: "", visitorIds: 3, users: 1, sessions: 4, pageViews: 9 }),
        row({ audience: "users", dimension: "total", key: "", visitorIds: 2, users: 2, sessions: 2, pageViews: 5 }),
      ],
    ];

    await expect(repository.rollupDay({ date: "2026-01-01" })).resolves.toBe(2);

    expect(neo4j.readScalars).toHaveBeenCalledTimes(3);
    const sessionCall = neo4j.readScalars.mock.calls[0][0];
    expect(sessionCall.query).toContain(audienceOf("analyticsSession"));
    expect(sessionCall.query).toContain("date(analyticsSession.startedAt) = date($date)");
    expect(sessionCall.query).toContain("OPTIONAL MATCH (analyticsSession)-[:BY_USER]->(user:User)");
    for (const dimension of ["total", "source", "medium", "campaign", "referrer", "landing"]) {
      expect(sessionCall.query).toContain(`'${dimension}'`);
    }
    for (const field of ["utmSource", "utmMedium", "utmCampaign", "referrerHost", "landingRoute"]) {
      expect(sessionCall.query).toContain(`coalesce(analyticsSession.${field}, $noneKey)`);
    }
    expect(sessionCall.query).not.toContain("'(none)'");
    expect(sessionCall.queryParams).toEqual({ date: "2026-01-01", noneKey: "(none)" });

    const pageViewCall = neo4j.readScalars.mock.calls[1][0];
    expect(pageViewCall.query).toContain(
      "MATCH (analyticsPageView:AnalyticsPageView)-[:IN_SESSION]->(analyticsSession:AnalyticsSession)",
    );
    expect(pageViewCall.query).toContain(audienceOf("analyticsSession"));
    expect(pageViewCall.query).toContain("'route' AS dimension");

    const rows = written[0].queryParams!.rows as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["2026-01-01|visitors|total|", "2026-01-01|users|total|"]);
  });

  it("writes one row set per audience", async () => {
    scalarResults = [
      [
        row({ audience: "visitors", dimension: "total", key: "", visitorIds: 1, users: 0, sessions: 1, pageViews: 1 }),
        row({ audience: "users", dimension: "total", key: "", visitorIds: 1, users: 1, sessions: 1, pageViews: 1 }),
      ],
    ];

    await repository.rollupDay({ date: "2026-01-01" });

    expect(written[0].queryParams!.rows).toEqual([
      {
        id: "2026-01-01|visitors|total|",
        audience: "visitors",
        dimension: "total",
        key: "",
        visitors: 1,
        sessions: 1,
        pageViews: 1,
      },
      {
        id: "2026-01-01|users|total|",
        audience: "users",
        dimension: "total",
        key: "",
        visitors: 1,
        sessions: 1,
        pageViews: 1,
      },
    ]);
    for (const written_row of written[0].queryParams!.rows as Array<{ visitors: number }>) {
      expect(written_row.visitors).not.toBe(2);
    }
  });

  it("counts people as users, not visitor ids, on the users audience", async () => {
    scalarResults = [
      [row({ audience: "users", dimension: "total", key: "", visitorIds: 3, users: 1, sessions: 3, pageViews: 6 })],
    ];

    await repository.rollupDay({ date: "2026-01-01" });

    expect((written[0].queryParams!.rows as Array<{ visitors: number }>)[0].visitors).toBe(1);
  });

  it("rolls up the exit page of each session", async () => {
    scalarResults = [
      [],
      [],
      [
        row({
          audience: "visitors",
          dimension: "exit",
          key: "/pricing",
          visitorIds: 2,
          users: 0,
          sessions: 2,
          pageViews: 5,
        }),
      ],
    ];

    await expect(repository.rollupDay({ date: "2026-01-01" })).resolves.toBe(1);

    const exitCall = neo4j.readScalars.mock.calls[2][0];
    expect(exitCall.query).toContain("ORDER BY analyticsPageView.createdAt DESC");
    expect(exitCall.query).toContain("collect(analyticsPageView.route)[0]");
    expect(exitCall.query).toContain("coalesce(lastRoute, $noneKey)");
    expect(exitCall.query).toContain("'exit' AS dimension");
    expect(exitCall.query).toContain(audienceOf("analyticsSession"));
    expect(exitCall.queryParams).toEqual({ date: "2026-01-01", noneKey: "(none)" });

    expect(written[0].queryParams!.rows).toEqual([
      {
        id: "2026-01-01|visitors|exit|/pricing",
        audience: "visitors",
        dimension: "exit",
        key: "/pricing",
        visitors: 2,
        sessions: 2,
        pageViews: 5,
      },
    ]);
  });

  it("writes the audience field, never section", async () => {
    scalarResults = [
      [row({ audience: "visitors", dimension: "total", key: "", visitorIds: 1, sessions: 1, pageViews: 1 })],
    ];

    await repository.rollupDay({ date: "2026-01-01" });

    const { query, queryParams } = written[0];
    expect(query).toContain("UNWIND $rows AS row");
    expect(query).toContain("MERGE (analyticsDailySummary:AnalyticsDailySummary {id: row.id})");
    expect(query).toContain("analyticsDailySummary.date = date(left($date, 10))");
    expect(query).toContain("analyticsDailySummary.audience = row.audience");
    expect(query).not.toContain(".section");
    expect(queryParams!.date).toBe("2026-01-01");
  });

  it("rollupDay sets every property ON CREATE only, so a re-run never lowers an existing row", async () => {
    scalarResults = [
      [row({ audience: "visitors", dimension: "total", key: "", visitorIds: 1, sessions: 1, pageViews: 1 })],
    ];

    await repository.rollupDay({ date: "2026-01-01" });

    const { query } = written[0];
    const afterMerge = query.slice(query.indexOf("MERGE ("));

    expect(afterMerge).toContain("ON CREATE SET");
    for (const field of ["visitors", "sessions", "pageViews"]) {
      expect(afterMerge).toContain(`analyticsDailySummary.${field} = row.${field}`);
    }
    expect(afterMerge).not.toContain("+=");
    expect(afterMerge).not.toContain("ON MATCH SET");
    expect(afterMerge.match(/\bSET\b/g)).toHaveLength(1);
  });

  it("rollupDay writes nothing for a day without data", async () => {
    await expect(repository.rollupDay({ date: "2026-01-01" })).resolves.toBe(0);
    expect(written).toHaveLength(0);
  });
});
