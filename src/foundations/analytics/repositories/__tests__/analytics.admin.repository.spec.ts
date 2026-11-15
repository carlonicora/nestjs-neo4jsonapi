import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsAdminRepository } from "../analytics.admin.repository";
import { audienceOf } from "../analytics-audience.cypher";

const int = (n: number) => ({ toNumber: () => n });

function makeRecord(values: Record<string, unknown>) {
  return { get: (k: string) => values[k] };
}

/**
 * Mirrors what the REAL `Neo4jService.initQuery()` returns when the calling
 * user's CLS session carries a `companyId` — i.e. an Administrator who ALSO
 * belongs to a company. It PREPENDS a company/currentUser MATCH bound to
 * `$companyId`. This repository must never use it (see the file header of
 * analytics.admin.repository.ts), so nothing below may observe either.
 */
const CLS_COMPANY_ID = "cls-company-id";
const CLS_USER_ID = "cls-user-id";

function initQueryLikeProduction() {
  return {
    query: `
        MATCH (company:Company {id: $companyId})
        MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company)
    `,
    queryParams: { companyId: CLS_COMPANY_ID, currentUserId: CLS_USER_ID },
  };
}

function makeRepo() {
  const neo4j = {
    initQuery: vi.fn(() => initQueryLikeProduction()),
    read: vi.fn(async () => ({ records: [] as any[] })),
    writeOne: vi.fn(async () => undefined),
  } as any;
  const repo = new AnalyticsAdminRepository(neo4j, {} as any, { get: () => CLS_COMPANY_ID } as any);
  return { repo, neo4j };
}

function capture(neo4j: any, respond?: (q: string, p: Record<string, unknown>) => any[]) {
  const seen: Array<{ q: string; p: Record<string, unknown> }> = [];
  neo4j.read.mockImplementation(async (q: string, p: Record<string, unknown>) => {
    seen.push({ q, p });
    return { records: respond ? respond(q, p) : [] };
  });
  return seen;
}

const WINDOW = {
  from: "2026-09-01T00:00:00.000Z",
  to: "2026-10-01T00:00:00.000Z",
  retentionCutoff: "2025-09-03",
};

const isSummaryPart = (q: string) => q.includes(":AnalyticsDailySummary");
const AUDIENCE_PREDICATE = `${audienceOf("analyticsSession")} = $audience`;
const BY_USER = "OPTIONAL MATCH (analyticsSession)-[:BY_USER]->(user:User)";

/** Every WITH clause that comes after the BY_USER optional match. */
const withClausesAfterByUser = (q: string): string[] => {
  const start = q.indexOf(BY_USER);
  if (start === -1) return [];
  return q
    .slice(start)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("WITH "));
};

describe("AnalyticsAdminRepository", () => {
  let repo: AnalyticsAdminRepository;
  let neo4j: any;

  beforeEach(() => {
    ({ repo, neo4j } = makeRepo());
  });

  it("timeline buckets by day with date() and by week/month with a bound truncation unit", async () => {
    const seen = capture(neo4j);

    await repo.findTimeline({ ...WINDOW, audience: "visitors", granularity: "day" });
    const day = seen.find((s) => !isSummaryPart(s.q))!;
    expect(day.q).toContain("date(analyticsSession.startedAt) AS bucket");
    expect(day.p.granularity).toBeNull();

    seen.length = 0;
    await repo.findTimeline({ ...WINDOW, audience: "visitors", granularity: "week" });
    const week = seen.find((s) => !isSummaryPart(s.q))!;
    expect(week.q).toContain("date.truncate($granularity, analyticsSession.startedAt)");
    expect(week.q).not.toContain("date.truncate('");
    for (const { p } of seen) expect(p.granularity).toBe("week");

    // Projected as a native temporal — never toString() in Cypher.
    for (const { q } of seen) expect(q).not.toContain("toString(");
  });

  it("rejects an unknown granularity before any read", async () => {
    const seen = capture(neo4j);
    await expect(repo.findTimeline({ ...WINDOW, audience: "visitors", granularity: "year" as any })).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it("timeline unions raw sessions inside the retention window with summaries before it", async () => {
    const bucket = { year: { low: 2026 }, month: { low: 9 }, day: { low: 1 } };
    const seen = capture(neo4j, (q) =>
      isSummaryPart(q)
        ? [makeRecord({ bucket, visitors: int(4), sessions: int(5), pageViews: int(6) })]
        : [makeRecord({ bucket, visitors: int(1), sessions: int(2), pageViews: int(3) })],
    );

    const rows = await repo.findTimeline({ ...WINDOW, audience: "visitors", granularity: "day" });

    expect(seen).toHaveLength(2);
    const raw = seen.find((s) => !isSummaryPart(s.q))!;
    const summary = seen.find((s) => isSummaryPart(s.q))!;
    expect(raw.q).toContain("analyticsSession.startedAt >= datetime($from)");
    expect(raw.q).toContain("date(analyticsSession.startedAt) >= date($retentionCutoff)");
    expect(summary.q).toContain("analyticsDailySummary.date < date($retentionCutoff)");
    expect(summary.q).toContain("dimension: 'total'");
    expect(raw.p.retentionCutoff).toBe("2025-09-03");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucket: "2026-09-01", visitors: 5, sessions: 7, pageViews: 9 });
  });

  it("orders merged timeline rows by bucket", async () => {
    const d = (day: number) => ({ year: { low: 2026 }, month: { low: 9 }, day: { low: day } });
    capture(neo4j, (q) =>
      isSummaryPart(q)
        ? [makeRecord({ bucket: d(1), visitors: int(1), sessions: int(1), pageViews: int(1) })]
        : [makeRecord({ bucket: d(3), visitors: int(1), sessions: int(1), pageViews: int(1) })],
    );

    const rows = await repo.findTimeline({ ...WINDOW, audience: "users", granularity: "day" });

    expect(rows.map((r) => r.bucket)).toEqual(["2026-09-01", "2026-09-03"]);
  });

  it("findTimeline ids and section carry the audience", async () => {
    capture(neo4j, (q) =>
      isSummaryPart(q)
        ? []
        : [
            makeRecord({
              // The shape the driver actually returns for a Neo4j Date.
              bucket: { year: { low: 2026 }, month: { low: 1 }, day: { low: 1 } },
              visitors: int(1),
              sessions: int(1),
              pageViews: int(1),
            }),
          ],
    );

    const rows = await repo.findTimeline({ ...WINDOW, audience: "users", granularity: "day" });

    expect(rows[0].bucket).toBe("2026-01-01");
    expect(rows[0].id).toBe("2026-01-01|users");
    expect(rows[0].section).toBe("users");
  });

  it("breakdown selects the whitelisted key expression", async () => {
    const seen = capture(neo4j);

    await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension: "source", limit: 20 });
    const source = seen.find((s) => !isSummaryPart(s.q))!;
    expect(source.q).toContain("coalesce(analyticsSession.utmSource, '(none)') AS key");
    for (const { p } of seen.filter((s) => isSummaryPart(s.q))) expect(p.dimension).toBe("source");

    seen.length = 0;
    await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension: "route", limit: 20 });
    const route = seen.find((s) => !isSummaryPart(s.q))!;
    expect(route.q).toContain(":AnalyticsPageView");
    expect(route.q).toContain("analyticsPageView.route");
    expect(route.q).toContain("analyticsPageView.createdAt >= datetime($from)");

    seen.length = 0;
    await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension: "landing", limit: 20 });
    expect(seen.find((s) => !isSummaryPart(s.q))!.q).toContain("analyticsSession.landingRoute");
  });

  it("exit reads each session's last page view", async () => {
    const seen = capture(neo4j);

    await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension: "exit", limit: 10 });

    const raw = seen.find((s) => !isSummaryPart(s.q))!;
    expect(raw.q).toContain("ORDER BY analyticsPageView.createdAt DESC");
    expect(raw.q).toContain("collect(analyticsPageView.route)[0]");
    expect(raw.q).toContain("analyticsSession.startedAt >= datetime($from)");
    expect(raw.q).toContain("coalesce(lastRoute, '(none)') AS key");
    const summary = seen.find((s) => isSummaryPart(s.q))!;
    expect(summary.p.dimension).toBe("exit");
  });

  it("breakdown rejects an unknown dimension before any read", async () => {
    const seen = capture(neo4j);
    await expect(
      repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension: "x) DETACH DELETE n //" as any, limit: 20 }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it("breakdown merges raw and summarised rows per key", async () => {
    capture(neo4j, (q) =>
      isSummaryPart(q)
        ? [makeRecord({ key: "google", visitors: int(10), sessions: int(10), pageViews: int(20) })]
        : [
            makeRecord({ key: "google", visitors: int(1), sessions: int(2), pageViews: int(3) }),
            makeRecord({ key: "(none)", visitors: int(4), sessions: int(4), pageViews: int(4) }),
          ],
    );

    const rows = await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension: "source", limit: 20 });

    expect(rows).toEqual([
      { id: "source|google", dimension: "source", key: "google", visitors: 11, sessions: 12, pageViews: 23 },
      { id: "source|(none)", dimension: "source", key: "(none)", visitors: 4, sessions: 4, pageViews: 4 },
    ]);
  });

  it("breakdown truncates to limit and folds the tail into 'other'", async () => {
    capture(neo4j, (q) =>
      isSummaryPart(q)
        ? []
        : [
            makeRecord({ key: "a", visitors: int(5), sessions: int(5), pageViews: int(5) }),
            makeRecord({ key: "b", visitors: int(3), sessions: int(3), pageViews: int(3) }),
            makeRecord({ key: "c", visitors: int(2), sessions: int(2), pageViews: int(2) }),
            makeRecord({ key: "d", visitors: int(1), sessions: int(1), pageViews: int(4) }),
          ],
    );

    const rows = await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension: "campaign", limit: 2 });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.key)).toEqual(["a", "b", "other"]);
    expect(rows[2]).toEqual({
      id: "campaign|other",
      dimension: "campaign",
      key: "other",
      visitors: 3,
      sessions: 3,
      pageViews: 6,
    });
  });

  it("ranks each dimension by its own number", async () => {
    capture(neo4j, (q) =>
      isSummaryPart(q)
        ? []
        : [
            makeRecord({ key: "a", visitors: int(5), sessions: int(1), pageViews: int(1) }),
            makeRecord({ key: "b", visitors: int(1), sessions: int(3), pageViews: int(9) }),
          ],
    );

    const keys = async (dimension: "route" | "landing" | "source" | "exit") =>
      (await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension, limit: 10 })).map((r) => r.key);

    expect(await keys("route")).toEqual(["b", "a"]);
    expect(await keys("landing")).toEqual(["b", "a"]);
    expect(await keys("exit")).toEqual(["b", "a"]);
    expect(await keys("source")).toEqual(["a", "b"]);
  });

  it("findSummary returns two total rows", async () => {
    const seen = capture(neo4j, (q, p) => {
      if (p.from !== WINDOW.from) return [];
      if (isSummaryPart(q)) return [makeRecord({ visitors: int(6), sessions: int(6), pageViews: int(12) })];
      return [
        makeRecord({
          visitors: int(4),
          visitorIds: int(3),
          consentedVisitors: int(1),
          sessions: int(4),
          pageViews: int(10),
        }),
      ];
    });

    const rows = await repo.findSummary({ ...WINDOW, audience: "visitors" });

    // raw + summarised for each of the two windows
    expect(seen).toHaveLength(4);
    expect(rows).toEqual([
      {
        id: "total|current",
        section: "total",
        window: "current",
        visitors: 10,
        sessions: 10,
        pageViews: 22,
        pagesPerSession: 2.2,
        consentShare: 0.3333,
      },
      {
        id: "total|previous",
        section: "total",
        window: "previous",
        visitors: 0,
        sessions: 0,
        pageViews: 0,
        pagesPerSession: 0,
        consentShare: 0,
      },
    ]);
  });

  it("summary queries the equal-length window immediately preceding `from` for previous", async () => {
    const seen = capture(neo4j);
    await repo.findSummary({ ...WINDOW, audience: "visitors" });

    const windows = seen.map((s) => `${s.p.from}..${s.p.to}`);
    expect(windows).toContain(`${WINDOW.from}..${WINDOW.to}`);
    expect(windows).toContain("2026-08-02T00:00:00.000Z..2026-09-01T00:00:00.000Z");
  });

  it("summary consent share is measured on raw visitor ids, not on users", async () => {
    capture(neo4j, (q, p) => {
      if (p.from !== WINDOW.from || isSummaryPart(q)) return [];
      return [
        makeRecord({
          visitors: int(2),
          visitorIds: int(4),
          consentedVisitors: int(2),
          sessions: int(4),
          pageViews: int(4),
        }),
      ];
    });

    const rows = await repo.findSummary({ ...WINDOW, audience: "users" });

    expect(rows[0]).toMatchObject({ visitors: 2, consentShare: 0.5 });
  });

  // Review Focus 1 — a returning user who logs in during a visit must never
  // appear on Site visitors: every raw read filters by the audience expression.
  it("every raw query filters by the audience expression", async () => {
    const seen = capture(neo4j);

    await repo.findSummary({ ...WINDOW, audience: "visitors" });
    await repo.findTimeline({ ...WINDOW, audience: "visitors", granularity: "day" });
    for (const dimension of ["source", "route", "landing", "exit"] as const)
      await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension, limit: 20 });

    const raws = seen.filter((s) => !isSummaryPart(s.q));
    expect(raws).toHaveLength(2 + 1 + 4);
    for (const { q, p } of raws) {
      expect(q).toContain(AUDIENCE_PREDICATE);
      expect(p.audience).toBe("visitors");
    }
    for (const { q, p } of seen) {
      expect(q).not.toContain("$section");
      expect(p.section).toBeUndefined();
    }
  });

  it("users count people through BY_USER", async () => {
    const seen = capture(neo4j);

    await repo.findSummary({ ...WINDOW, audience: "users" });
    await repo.findTimeline({ ...WINDOW, audience: "users", granularity: "day" });
    for (const dimension of ["source", "route", "landing", "exit"] as const)
      await repo.findBreakdown({ ...WINDOW, audience: "users", dimension, limit: 20 });

    const raws = seen.filter((s) => !isSummaryPart(s.q));
    expect(raws).toHaveLength(7);
    for (const { q, p } of raws) {
      expect(q).toContain(BY_USER);
      expect(q).toContain("count(DISTINCT user)");
      expect(q).toMatch(/count\(DISTINCT user\)\s+AS visitors/);
      const withs = withClausesAfterByUser(q);
      expect(withs.length).toBeGreaterThan(0);
      for (const w of withs) expect(w).toMatch(/\buser\b/);
      expect(p.audience).toBe("users");
    }

    seen.length = 0;
    await repo.findSummary({ ...WINDOW, audience: "visitors" });
    await repo.findTimeline({ ...WINDOW, audience: "visitors", granularity: "day" });
    for (const dimension of ["source", "route", "landing", "exit"] as const)
      await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension, limit: 20 });

    for (const { q } of seen.filter((s) => !isSummaryPart(s.q))) {
      expect(q).toMatch(/count\(DISTINCT analyticsSession\.visitorId\)\s+AS visitors/);
      expect(q).not.toMatch(/count\(DISTINCT user\)\s+AS visitors/);
    }
  });

  it("summarised days are read for the requested audience only", async () => {
    const seen = capture(neo4j);

    await repo.findSummary({ ...WINDOW, audience: "users" });
    await repo.findTimeline({ ...WINDOW, audience: "users", granularity: "day" });
    for (const dimension of ["source", "route", "landing", "exit"] as const)
      await repo.findBreakdown({ ...WINDOW, audience: "users", dimension, limit: 20 });

    const summarised = seen.filter((s) => isSummaryPart(s.q));
    expect(summarised).toHaveLength(2 + 1 + 4);
    for (const { q, p } of summarised) {
      expect(q).toContain("analyticsDailySummary.audience = $audience");
      expect(q).not.toContain(".section");
      expect(p.audience).toBe("users");
    }
  });

  it("rejects an unknown audience before any read", async () => {
    const seen = capture(neo4j);
    await expect(repo.findSummary({ ...WINDOW, audience: "' OR 1=1" as any })).rejects.toThrow();
    await expect(repo.findTimeline({ ...WINDOW, audience: "all" as any, granularity: "day" })).rejects.toThrow();
    await expect(
      repo.findBreakdown({ ...WINDOW, audience: "all" as any, dimension: "source", limit: 20 }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  // An Administrator who also belongs to a company has a CLS companyId;
  // initQuery() would prepend `MATCH (company:Company {id: $companyId})`.
  it("does not name a companyId parameter and never inherits the caller's CLS scoping", async () => {
    const seen = capture(neo4j);

    await repo.findSummary({ ...WINDOW, audience: "visitors" });
    await repo.findTimeline({ ...WINDOW, audience: "users", granularity: "month" });
    for (const dimension of ["source", "medium", "campaign", "referrer", "route", "landing", "exit"] as const)
      await repo.findBreakdown({ ...WINDOW, audience: "visitors", dimension, limit: 20 });

    expect(neo4j.initQuery).not.toHaveBeenCalled();
    expect(seen.length).toBeGreaterThan(0);
    for (const { q, p } of seen) {
      expect(Object.keys(p)).not.toContain("companyId");
      expect(p.currentUserId).toBeUndefined();
      expect(q).not.toContain("$companyId");
      expect(q).not.toContain("currentUser");
    }
  });
});
