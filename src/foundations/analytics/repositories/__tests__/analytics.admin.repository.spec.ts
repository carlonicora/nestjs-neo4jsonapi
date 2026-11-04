import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsAdminRepository } from "../analytics.admin.repository";

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
const isDistinctTotal = (q: string) => q.includes("AS distinctVisitors");

describe("AnalyticsAdminRepository", () => {
  let repo: AnalyticsAdminRepository;
  let neo4j: any;

  beforeEach(() => {
    ({ repo, neo4j } = makeRepo());
  });

  it("timeline buckets by day with date() and by week/month with a bound truncation unit", async () => {
    const seen = capture(neo4j);

    await repo.findTimeline({ ...WINDOW, section: "all", granularity: "day" });
    const day = seen.find((s) => !isSummaryPart(s.q))!;
    expect(day.q).toContain("date(analyticsSession.startedAt) AS bucket");
    expect(day.p.granularity).toBeNull();

    seen.length = 0;
    await repo.findTimeline({ ...WINDOW, section: "all", granularity: "week" });
    const week = seen.find((s) => !isSummaryPart(s.q))!;
    expect(week.q).toContain("date.truncate($granularity, analyticsSession.startedAt)");
    expect(week.q).not.toContain("date.truncate('");
    for (const { p } of seen) expect(p.granularity).toBe("week");

    // Projected as a native temporal — never toString() in Cypher.
    for (const { q } of seen) expect(q).not.toContain("toString(");
  });

  it("rejects an unknown granularity before any read", async () => {
    const seen = capture(neo4j);
    await expect(repo.findTimeline({ ...WINDOW, section: "all", granularity: "year" as any })).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it("timeline unions raw sessions inside the retention window with summaries before it", async () => {
    const bucket = { year: { low: 2026 }, month: { low: 9 }, day: { low: 1 } };
    const seen = capture(neo4j, (q) =>
      isSummaryPart(q)
        ? [makeRecord({ bucket, visitors: int(4), sessions: int(5), pageViews: int(6) })]
        : [makeRecord({ bucket, visitors: int(1), sessions: int(2), pageViews: int(3) })],
    );

    const rows = await repo.findTimeline({ ...WINDOW, section: "all", granularity: "day" });

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

    const rows = await repo.findTimeline({ ...WINDOW, section: "app", granularity: "day" });

    expect(rows.map((r) => r.bucket)).toEqual(["2026-09-01", "2026-09-03"]);
  });

  it("maps bucket through convertFieldValue as a YYYY-MM-DD string", async () => {
    capture(neo4j, (q) =>
      isSummaryPart(q)
        ? []
        : [
            makeRecord({
              // The shape the driver actually returns for a Neo4j Date.
              bucket: { year: { low: 2026 }, month: { low: 10 }, day: { low: 1 } },
              visitors: int(1),
              sessions: int(1),
              pageViews: int(1),
            }),
          ],
    );

    const rows = await repo.findTimeline({ ...WINDOW, section: "public", granularity: "day" });

    expect(rows[0].bucket).toBe("2026-10-01");
    expect(rows[0].id).toBe("2026-10-01|public");
    expect(rows[0].section).toBe("public");
  });

  it("breakdown selects the whitelisted key expression", async () => {
    const seen = capture(neo4j);

    await repo.findBreakdown({ ...WINDOW, section: "all", dimension: "source", limit: 20 });
    const source = seen.find((s) => !isSummaryPart(s.q))!;
    expect(source.q).toContain("coalesce(analyticsSession.utmSource, '(none)') AS key");
    for (const { p } of seen.filter((s) => isSummaryPart(s.q))) expect(p.dimension).toBe("source");

    seen.length = 0;
    await repo.findBreakdown({ ...WINDOW, section: "all", dimension: "route", limit: 20 });
    const route = seen.find((s) => !isSummaryPart(s.q))!;
    expect(route.q).toContain(":AnalyticsPageView");
    expect(route.q).toContain("analyticsPageView.route");
    expect(route.q).toContain("analyticsPageView.createdAt >= datetime($from)");

    seen.length = 0;
    await repo.findBreakdown({ ...WINDOW, section: "all", dimension: "landing", limit: 20 });
    expect(seen.find((s) => !isSummaryPart(s.q))!.q).toContain("analyticsSession.landingRoute");
  });

  it("breakdown rejects an unknown dimension before any read", async () => {
    const seen = capture(neo4j);
    await expect(
      repo.findBreakdown({ ...WINDOW, section: "all", dimension: "x) DETACH DELETE n //" as any, limit: 20 }),
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

    const rows = await repo.findBreakdown({ ...WINDOW, section: "all", dimension: "source", limit: 20 });

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

    const rows = await repo.findBreakdown({ ...WINDOW, section: "all", dimension: "campaign", limit: 2 });

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

  it("summary returns {public, app, total} × {current, previous} zero-filled", async () => {
    let rawCall = 0;
    const seen = capture(neo4j, (q, p) => {
      if (isSummaryPart(q)) return [];
      if (isDistinctTotal(q)) return p.from === WINDOW.from ? [makeRecord({ distinctVisitors: int(3) })] : [];
      rawCall += 1;
      // Only the first raw read (current window) has data, and only for public.
      return rawCall === 1
        ? [
            makeRecord({
              section: "public",
              visitors: int(3),
              consentedVisitors: int(1),
              sessions: int(4),
              pageViews: int(10),
            }),
          ]
        : [];
    });

    const rows = await repo.findSummary({ ...WINDOW, section: "all" });

    // raw + summary + distinct total for each of the two windows
    expect(seen).toHaveLength(6);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.id).sort()).toEqual(
      ["app|current", "app|previous", "public|current", "public|previous", "total|current", "total|previous"].sort(),
    );

    const publicCurrent = rows.find((r) => r.id === "public|current")!;
    expect(publicCurrent).toMatchObject({ visitors: 3, sessions: 4, pageViews: 10, pagesPerSession: 2.5 });
    expect(publicCurrent.consentShare).toBe(0.3333);

    const appCurrent = rows.find((r) => r.id === "app|current")!;
    expect(appCurrent).toMatchObject({ visitors: 0, sessions: 0, pageViews: 0, pagesPerSession: 0, consentShare: 0 });

    const totalCurrent = rows.find((r) => r.id === "total|current")!;
    expect(totalCurrent).toMatchObject({
      section: "total",
      window: "current",
      visitors: 3,
      sessions: 4,
      pageViews: 10,
    });

    const totalPrevious = rows.find((r) => r.id === "total|previous")!;
    expect(totalPrevious).toMatchObject({ visitors: 0, sessions: 0, pageViews: 0, pagesPerSession: 0 });
  });

  it("summary queries the equal-length window immediately preceding `from` for previous", async () => {
    const seen = capture(neo4j);
    await repo.findSummary({ ...WINDOW, section: "all" });

    const windows = seen.map((s) => `${s.p.from}..${s.p.to}`);
    expect(windows).toContain(`${WINDOW.from}..${WINDOW.to}`);
    expect(windows).toContain("2026-08-02T00:00:00.000Z..2026-09-01T00:00:00.000Z");
  });

  it("summary total.visitors is the distinct count across sections, not the sections' sum", async () => {
    const seen = capture(neo4j, (q, p) => {
      if (p.from !== WINDOW.from) return [];
      if (isSummaryPart(q)) return [];
      // One visitor with sessions in both sections: 1 public + 1 app by section,
      // but only 1 distinct visitor overall.
      if (isDistinctTotal(q)) return [makeRecord({ distinctVisitors: int(1) })];
      return [
        makeRecord({
          section: "public",
          visitors: int(1),
          consentedVisitors: int(0),
          sessions: int(1),
          pageViews: int(2),
        }),
        makeRecord({
          section: "app",
          visitors: int(1),
          consentedVisitors: int(0),
          sessions: int(1),
          pageViews: int(3),
        }),
      ];
    });

    const rows = await repo.findSummary({ ...WINDOW, section: "all" });

    const distinctQuery = seen.find((s) => isDistinctTotal(s.q))!.q;
    expect(distinctQuery).toContain("count(DISTINCT analyticsSession.visitorId)");
    expect(distinctQuery).not.toContain("analyticsSession.section AS section");

    expect(rows.find((r) => r.id === "public|current")).toMatchObject({ visitors: 1 });
    expect(rows.find((r) => r.id === "app|current")).toMatchObject({ visitors: 1 });
    // Sessions and page views stay sums; visitors is the distinct count.
    expect(rows.find((r) => r.id === "total|current")).toMatchObject({ visitors: 1, sessions: 2, pageViews: 5 });
  });

  it("summary total.visitors adds the summarised total rows to the raw distinct count", async () => {
    capture(neo4j, (q, p) => {
      if (p.from !== WINDOW.from) return [];
      if (isSummaryPart(q))
        return [
          makeRecord({ section: "public", visitors: int(5), sessions: int(5), pageViews: int(5) }),
          makeRecord({ section: "app", visitors: int(2), sessions: int(2), pageViews: int(2) }),
        ];
      if (isDistinctTotal(q)) return [makeRecord({ distinctVisitors: int(1) })];
      return [];
    });

    const rows = await repo.findSummary({ ...WINDOW, section: "all" });

    expect(rows.find((r) => r.id === "total|current")).toMatchObject({ visitors: 8, sessions: 7, pageViews: 7 });
  });

  it("summary adds the summarised part, which carries no consent split", async () => {
    capture(neo4j, (q, p) => {
      if (p.from !== WINDOW.from) return [];
      return isSummaryPart(q)
        ? [makeRecord({ section: "app", visitors: int(6), sessions: int(6), pageViews: int(12) })]
        : [
            makeRecord({
              section: "app",
              visitors: int(4),
              consentedVisitors: int(2),
              sessions: int(4),
              pageViews: int(4),
            }),
          ];
    });

    const rows = await repo.findSummary({ ...WINDOW, section: "all" });
    const appCurrent = rows.find((r) => r.id === "app|current")!;

    expect(appCurrent).toMatchObject({ visitors: 10, sessions: 10, pageViews: 16, pagesPerSession: 1.6 });
    // Consent share is measured on the raw part only: 2 of 4 raw visitors.
    expect(appCurrent.consentShare).toBe(0.5);
  });

  it("section filter: 'public' adds a bound section predicate, 'all' adds nothing", async () => {
    const seen = capture(neo4j);

    await repo.findTimeline({ ...WINDOW, section: "public", granularity: "day" });
    await repo.findBreakdown({ ...WINDOW, section: "public", dimension: "source", limit: 20 });
    await repo.findSummary({ ...WINDOW, section: "public" });
    for (const { q, p } of seen) {
      if (isSummaryPart(q)) expect(q).toContain("analyticsDailySummary.section = $section");
      else expect(q).toContain("analyticsSession.section = $section");
      expect(p.section).toBe("public");
    }

    seen.length = 0;
    await repo.findBreakdown({ ...WINDOW, section: "public", dimension: "route", limit: 20 });
    expect(seen.find((s) => !isSummaryPart(s.q))!.q).toContain("analyticsPageView.section = $section");

    seen.length = 0;
    await repo.findTimeline({ ...WINDOW, section: "all", granularity: "day" });
    await repo.findBreakdown({ ...WINDOW, section: "all", dimension: "route", limit: 20 });
    await repo.findSummary({ ...WINDOW, section: "all" });
    for (const { q, p } of seen) {
      expect(q).not.toContain("$section");
      expect(p.section).toBeUndefined();
    }
  });

  it("rejects an unknown section before any read", async () => {
    const seen = capture(neo4j);
    await expect(repo.findSummary({ ...WINDOW, section: "' OR 1=1" as any })).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  // Review Focus 4 — an Administrator who also belongs to a company has a CLS
  // companyId; initQuery() would prepend `MATCH (company:Company {id: $companyId})`.
  it("does not name a companyId parameter and never inherits the caller's CLS scoping", async () => {
    const seen = capture(neo4j);

    await repo.findSummary({ ...WINDOW, section: "all" });
    await repo.findTimeline({ ...WINDOW, section: "app", granularity: "month" });
    for (const dimension of ["source", "medium", "campaign", "referrer", "route", "landing"] as const)
      await repo.findBreakdown({ ...WINDOW, section: "all", dimension, limit: 20 });

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

describe("AnalyticsAdminRepository.findDailyUniques", () => {
  const RANGE = { fromDate: "2026-10-01", toDate: "2026-10-05" };
  const nd = (day: number) => ({ year: { low: 2026 }, month: { low: 10 }, day: { low: day } });
  const isStored = (q: string) => q.includes(":AnalyticsDailyUnique");
  const isOldSummary = (q: string) => q.includes(":AnalyticsDailySummary");
  const isRaw = (q: string) => q.includes(":AnalyticsSession");

  let repo: AnalyticsAdminRepository;
  let neo4j: any;

  beforeEach(() => {
    ({ repo, neo4j } = makeRepo());
  });

  it("runs three reads bound to fromDate/toDate, never through initQuery or a companyId", async () => {
    const seen = capture(neo4j);

    await repo.findDailyUniques(RANGE);

    expect(seen).toHaveLength(3);
    expect(neo4j.initQuery).not.toHaveBeenCalled();
    for (const { q, p } of seen) {
      expect(p.fromDate).toBe("2026-10-01");
      expect(p.toDate).toBe("2026-10-05");
      expect(Object.keys(p)).not.toContain("companyId");
      expect(p.currentUserId).toBeUndefined();
      expect(q).not.toContain("$companyId");
      expect(q).not.toContain("currentUser");
    }
  });

  it("counts raw sessions per day by distinct visitor and distinct BY_USER user, with no section or retention predicate", async () => {
    const seen = capture(neo4j);

    await repo.findDailyUniques(RANGE);

    const raw = seen.find((s) => isRaw(s.q))!;
    expect(raw).toBeDefined();
    expect(raw.q).toContain("date(analyticsSession.startedAt) >= date($fromDate)");
    expect(raw.q).toContain("date(analyticsSession.startedAt) <= date($toDate)");
    expect(raw.q).toContain("count(DISTINCT analyticsSession.visitorId)");
    expect(raw.q).toMatch(/OPTIONAL MATCH \(analyticsSession\)-\[:BY_USER\]->\(user:User\)/);
    expect(raw.q).toContain("count(DISTINCT user)");
    expect(raw.q).toContain("date(analyticsSession.startedAt) AS day");
    expect(raw.q).not.toContain("section");
    expect(raw.q).not.toContain("retentionCutoff");
    expect(raw.p.section).toBeUndefined();
    expect(raw.p.retentionCutoff).toBeUndefined();
  });

  it("reads stored AnalyticsDailyUnique nodes in the same date window", async () => {
    const seen = capture(neo4j);

    await repo.findDailyUniques(RANGE);

    const stored = seen.find((s) => isStored(s.q))!;
    expect(stored).toBeDefined();
    expect(stored.q).toContain("analyticsDailyUnique.date >= date($fromDate)");
    expect(stored.q).toContain("analyticsDailyUnique.date <= date($toDate)");
  });

  it("reads the distinct days of old total summaries in the window", async () => {
    const seen = capture(neo4j);

    await repo.findDailyUniques(RANGE);

    const old = seen.find((s) => isOldSummary(s.q))!;
    expect(old).toBeDefined();
    expect(old.q).toContain("dimension: 'total'");
    expect(old.q).toContain("RETURN DISTINCT analyticsDailySummary.date AS day");
    expect(old.q).toContain("analyticsDailySummary.date >= date($fromDate)");
    expect(old.q).toContain("analyticsDailySummary.date <= date($toDate)");
  });

  it("merges the three sources by day, converting integers and dates", async () => {
    capture(neo4j, (q) => {
      if (isStored(q)) return [makeRecord({ day: nd(1), visitors: int(9), users: int(4) })];
      if (isOldSummary(q)) return [makeRecord({ day: nd(1) }), makeRecord({ day: nd(3) })];
      if (isRaw(q))
        return [
          makeRecord({ day: nd(1), visitors: int(2), users: int(1) }),
          makeRecord({ day: nd(2), visitors: int(5), users: int(0) }),
        ];
      return [];
    });

    const rows = await repo.findDailyUniques(RANGE);

    expect(rows).toEqual([
      { day: "2026-10-01", stored: { visitors: 9, users: 4 }, raw: { visitors: 2, users: 1 }, hasOldSummary: true },
      { day: "2026-10-02", stored: null, raw: { visitors: 5, users: 0 }, hasOldSummary: false },
      { day: "2026-10-03", stored: null, raw: null, hasOldSummary: true },
    ]);
  });
});
