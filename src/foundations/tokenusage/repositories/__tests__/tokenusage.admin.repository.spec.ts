import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokenUsageAdminRepository } from "../tokenusage.admin.repository";

const int = (n: number) => ({ toNumber: () => n });

function makeRecord(values: Record<string, unknown>) {
  return { get: (k: string) => values[k] };
}

/**
 * Mirrors what the REAL `Neo4jService.initQuery()` returns when the calling
 * user's CLS session carries a `companyId` — i.e. an Administrator who ALSO
 * belongs to a company, which is exactly the shape the e2e platformAdmin
 * fixture has. It PREPENDS a company/currentUser MATCH bound to `$companyId`
 * and seeds `queryParams.companyId` with the CALLER's company.
 *
 * A `{ query: "", queryParams: {} }` stub is what let the CLS-scoping bug ship:
 * with it, nothing in this spec could observe the prepended MATCH, nor the fact
 * that this repository rebinds `$companyId` to the admin's REQUESTED company
 * filter — poisoning the prepended MATCH with a value that means something else.
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

function makeRepo(records: any[]) {
  const neo4j = {
    initQuery: vi.fn(() => initQueryLikeProduction()),
    read: vi.fn(async () => ({ records })),
    writeOne: vi.fn(async () => undefined),
  } as any;
  const repo = new TokenUsageAdminRepository(neo4j, {} as any, { get: () => undefined } as any);
  return { repo, neo4j };
}

describe("TokenUsageAdminRepository", () => {
  let capturedQuery: string;

  beforeEach(() => {
    capturedQuery = "";
  });

  it("returns six summary rows keyed by scope and window", async () => {
    const { repo, neo4j } = makeRepo([
      makeRecord({
        scope: "customer",
        cost: 9.46,
        credits: 3394,
        tokensIn: int(49244143),
        tokensOut: int(10),
        cached: int(75752),
        calls: int(2956),
      }),
      makeRecord({
        scope: "platform",
        cost: 9.47,
        credits: 6140,
        tokensIn: int(48219808),
        tokensOut: int(20),
        cached: int(0),
        calls: int(7681),
      }),
    ]);
    neo4j.read.mockImplementation(async (q: string) => {
      capturedQuery = q;
      return { records: neo4j.read.mock.results.length ? [] : [] };
    });
    // re-arm with real data for both windows
    let call = 0;
    neo4j.read.mockImplementation(async (q: string) => {
      capturedQuery += q;
      call += 1;
      return {
        records: [
          makeRecord({
            scope: "customer",
            cost: call,
            credits: call,
            tokensIn: int(call),
            tokensOut: int(call),
            cached: int(call),
            calls: int(call),
          }),
          makeRecord({
            scope: "platform",
            cost: call,
            credits: call,
            tokensIn: int(call),
            tokensOut: int(call),
            cached: int(call),
            calls: int(call),
          }),
        ],
      };
    });

    const rows = await repo.findSummary({ from: "2026-08-01T00:00:00.000Z", to: "2026-08-07T00:00:00.000Z" });

    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [
        "customer|current",
        "customer|previous",
        "platform|current",
        "platform|previous",
        "total|current",
        "total|previous",
      ].sort(),
    );
    const totalCurrent = rows.find((r) => r.id === "total|current")!;
    expect(totalCurrent.calls).toBe(2);
  });

  it("constrains every traversal to a labelled target so orphan nodes cannot leak", async () => {
    const { repo, neo4j } = makeRepo([]);
    let seen = "";
    neo4j.read.mockImplementation(async (q: string) => {
      seen += q;
      return { records: [] };
    });

    await repo.findSummary({ from: "2026-08-01T00:00:00.000Z", to: "2026-08-07T00:00:00.000Z" });
    await repo.findBreakdown({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-07T00:00:00.000Z",
      dimension: "user",
      scope: "customer",
      limit: 10,
    });

    expect(seen).not.toMatch(/\[:BELONGS_TO\]->\((?!:Company|c:Company)/);
    expect(seen).not.toMatch(/\[:TRIGGERED_BY\]->\((?!:User|u:User)/);
  });

  // Regression — ADM-53..57. Every aggregation here read zero rows on the live
  // stack: initQuery() prepends `MATCH (company:Company {id: $companyId})` when
  // the caller has a CLS company, and this repository then rebinds the SAME
  // `$companyId` parameter to the admin's requested company FILTER — `null` in
  // the page's default state. `MATCH (:Company {id: null})` matches nothing and,
  // being a plain MATCH, reduces the whole aggregation to zero rows, which the
  // JS zero-fill then renders as a normal-looking empty dashboard.
  it("never inherits the caller's CLS company scoping — this dashboard is platform-wide", async () => {
    const { repo, neo4j } = makeRepo([]);
    const seen: Array<{ q: string; p: Record<string, unknown> }> = [];
    neo4j.read.mockImplementation(async (q: string, p: Record<string, unknown>) => {
      seen.push({ q, p });
      return { records: [] };
    });

    const window = { from: "2026-08-01T00:00:00.000Z", to: "2026-08-07T00:00:00.000Z" };
    await repo.findSummary(window);
    await repo.findTimeline({ ...window, granularity: "day", stackBy: "scope" });
    await repo.findBreakdown({ ...window, dimension: "company", scope: "customer", limit: 10 });

    // findSummary issues two reads (current + previous window), plus one each
    // for the timeline and the breakdown.
    expect(seen).toHaveLength(4);
    for (const { q, p } of seen) {
      expect(q).not.toContain("MATCH (company:Company");
      expect(q).not.toContain("currentUser");
      expect(p.currentUserId).toBeUndefined();
      // No company filter was requested, so the filter parameter is null — and
      // nothing in the query text may treat null as "the caller's company".
      expect(p.companyId).toBeNull();
    }
  });

  it("binds $companyId to the REQUESTED company filter, never to the caller's own", async () => {
    const { repo, neo4j } = makeRepo([]);
    const seen: Array<Record<string, unknown>> = [];
    neo4j.read.mockImplementation(async (_q: string, p: Record<string, unknown>) => {
      seen.push(p);
      return { records: [] };
    });

    const window = { from: "2026-08-01T00:00:00.000Z", to: "2026-08-07T00:00:00.000Z" };
    await repo.findSummary({ ...window, companyId: "requested-company-id" });
    await repo.findTimeline({ ...window, granularity: "day", stackBy: "scope", companyId: "requested-company-id" });
    await repo.findBreakdown({
      ...window,
      dimension: "company",
      scope: "customer",
      limit: 10,
      companyId: "requested-company-id",
    });

    expect(seen).toHaveLength(4);
    for (const p of seen) expect(p.companyId).toBe("requested-company-id");
  });

  it("appends an 'other' rollup row holding the exact remainder beyond the limit", async () => {
    const { repo, neo4j } = makeRepo([]);
    neo4j.read.mockImplementation(async () => ({
      records: [
        makeRecord({
          id: "a",
          label: "Studio A",
          sublabel: null,
          cost: 5,
          credits: 5,
          tokensIn: int(5),
          tokensOut: int(5),
          cached: int(0),
          calls: int(5),
          activeUsers: int(1),
          monthlyCredits: null,
          availableMonthlyCredits: null,
        }),
        makeRecord({
          id: "b",
          label: "Studio B",
          sublabel: null,
          cost: 3,
          credits: 3,
          tokensIn: int(3),
          tokensOut: int(3),
          cached: int(0),
          calls: int(3),
          activeUsers: int(1),
          monthlyCredits: null,
          availableMonthlyCredits: null,
        }),
        makeRecord({
          id: "c",
          label: "Studio C",
          sublabel: null,
          cost: 2,
          credits: 2,
          tokensIn: int(2),
          tokensOut: int(2),
          cached: int(0),
          calls: int(2),
          activeUsers: int(1),
          monthlyCredits: null,
          availableMonthlyCredits: null,
        }),
      ],
    }));

    const rows = await repo.findBreakdown({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-07T00:00:00.000Z",
      dimension: "company",
      scope: "customer",
      limit: 2,
    });

    expect(rows).toHaveLength(3);
    expect(rows[2].id).toBe("other");
    expect(rows[2].cost).toBe(2);
    expect(rows[2].calls).toBe(2);
  });

  it("buckets the timeline by the requested granularity, binding the unit as a parameter", async () => {
    const { repo, neo4j } = makeRepo([]);
    let seen = "";
    let seenParams: Record<string, unknown> = {};
    neo4j.read.mockImplementation(async (q: string, p: Record<string, unknown>) => {
      seen = q;
      seenParams = p;
      return { records: [] };
    });

    await repo.findTimeline({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-07T00:00:00.000Z",
      granularity: "week",
      stackBy: "scope",
    });
    // Bound, never interpolated — "ALWAYS parameterized Cypher, NEVER interpolate
    // strings". Cypher accepts a parameter for date.truncate's unit.
    expect(seen).toContain("date.truncate($granularity");
    expect(seen).not.toContain("date.truncate('");
    expect(seenParams.granularity).toBe("week");

    await repo.findTimeline({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-07T00:00:00.000Z",
      granularity: "day",
      stackBy: "scope",
    });
    expect(seen).toContain("date(tokenusage.createdAt)");
    expect(seenParams.granularity).toBeNull();
  });

  it("projects the bucket as a native temporal — never toString() in Cypher", async () => {
    const { repo, neo4j } = makeRepo([]);
    let seen = "";
    neo4j.read.mockImplementation(async (q: string) => {
      seen = q;
      return { records: [] };
    });

    await repo.findTimeline({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-07T00:00:00.000Z",
      granularity: "day",
      stackBy: "scope",
    });

    // Converting the temporal inside the query would make the descriptor's
    // type: "date" inert and hand-roll a conversion the framework owns.
    expect(seen).not.toContain("toString(");
  });

  it("converts the native Neo4j Date through the framework converter, not by hand", async () => {
    const { repo, neo4j } = makeRepo([]);
    neo4j.read.mockImplementation(async () => ({
      records: [
        makeRecord({
          // The shape the driver actually returns for a Neo4j Date.
          bucket: { year: { low: 2026 }, month: { low: 8 }, day: { low: 1 } },
          series: "customer",
          cost: 1,
          credits: 1,
          tokensIn: int(1),
          tokensOut: int(1),
          cached: int(0),
          calls: int(1),
        }),
      ],
    }));

    const rows = await repo.findTimeline({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-07T00:00:00.000Z",
      granularity: "day",
      stackBy: "scope",
    });

    expect(rows[0].bucket).toBe("2026-08-01");
    expect(rows[0].id).toBe("2026-08-01|customer");
  });
});
