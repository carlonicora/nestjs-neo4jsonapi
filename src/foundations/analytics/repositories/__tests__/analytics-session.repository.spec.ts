import { Date as Neo4jDate, int } from "neo4j-driver";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsResolvedPageView } from "../../interfaces/analytics.resolved-page-view";
import { AnalyticsSessionRepository } from "../analytics-session.repository";

const record = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] });

describe("AnalyticsSessionRepository", () => {
  let repository: AnalyticsSessionRepository;
  let neo4j: any;
  let written: Array<{ query: string; queryParams?: Record<string, unknown> }>;

  // Simulates the prefix Neo4jService.initQuery() emits on every authenticated
  // request (CLS holds companyId/userId).
  const initQueryPrefix = "MATCH (company:Company {id: $companyId})\n";

  const input = (overrides: Partial<AnalyticsResolvedPageView> = {}): AnalyticsResolvedPageView => ({
    visitorId: "c:6f1c2d3e-0000-4000-8000-000000000001",
    consented: true,
    path: "/rolls/6f1c2d3e-0000-4000-8000-000000000002",
    route: "/rolls/:id",
    section: "app",
    referrerHost: "linkedin.com",
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "launch",
    utmTerm: null,
    utmContent: null,
    deviceType: "desktop",
    userId: null,
    receivedAt: "2026-10-03T10:00:00.000Z",
    sessionTimeoutMinutes: 30,
    ...overrides,
  });

  beforeEach(() => {
    written = [];
    neo4j = {
      initQuery: vi.fn(() => ({
        query: initQueryPrefix,
        queryParams: { companyId: "company-1", currentUserId: "u-1" },
      })),
      writeOne: vi.fn(async (q: any) => {
        written.push({ query: q.query, queryParams: q.queryParams });
        return null;
      }),
      read: vi.fn(async () => ({ records: [] })),
      readOne: vi.fn(),
      readMany: vi.fn(async () => []),
      executeInTransaction: vi.fn(async () => [{ records: [record({ deleted: int(0) })] }]),
    };
    const cls = { get: vi.fn(() => undefined), set: vi.fn() } as unknown as ClsService;
    const securityService = {
      userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
    } as any;

    repository = new AnalyticsSessionRepository(neo4j, securityService, cls);
  });

  describe("onModuleInit", () => {
    it("creates the indexes on top of the descriptor constraints", async () => {
      await repository.onModuleInit();

      const queries = written.map((w) => w.query);

      expect(queries).toContain(
        "CREATE INDEX analyticsSession_visitorId_lastSeenAt IF NOT EXISTS FOR (analyticsSession:AnalyticsSession) ON (analyticsSession.visitorId, analyticsSession.lastSeenAt)",
      );
      expect(queries).toContain(
        "CREATE INDEX analyticsSession_startedAt IF NOT EXISTS FOR (analyticsSession:AnalyticsSession) ON (analyticsSession.startedAt)",
      );
      expect(queries.some((q) => q.includes("CREATE CONSTRAINT analyticsSession_id IF NOT EXISTS"))).toBe(true);
    });
  });

  describe("recordPageView", () => {
    it("reuses an open session", async () => {
      neo4j.writeOne.mockImplementationOnce(async (q: any) => {
        written.push({ query: q.query, queryParams: q.queryParams });
        return { id: "existing-session" };
      });

      const result = await repository.recordPageView(input());

      expect(result).toEqual({ sessionId: "existing-session", created: false });
      expect(written).toHaveLength(1);
      const { query, queryParams } = written[0];

      expect(query).toContain("lastSeenAt >= datetime($receivedAt) - duration({minutes: $sessionTimeoutMinutes})");
      expect(query).toContain("SET analyticsSession.lastSeenAt = datetime($receivedAt)");
      expect(query).toContain("pageViews = analyticsSession.pageViews + 1");
      expect(query).toContain("(analyticsPageView:AnalyticsPageView {");
      expect(query).toContain("createdAt: datetime($receivedAt)");
      expect(query).toContain("-[:IN_SESSION]->");
      expect(query).toContain("RETURN analyticsSession");

      expect(queryParams).toMatchObject({
        visitorId: "c:6f1c2d3e-0000-4000-8000-000000000001",
        path: "/rolls/6f1c2d3e-0000-4000-8000-000000000002",
        route: "/rolls/:id",
        section: "app",
        receivedAt: "2026-10-03T10:00:00.000Z",
        sessionTimeoutMinutes: 30,
      });
      expect(queryParams).not.toHaveProperty("clientIp");
      expect(queryParams).not.toHaveProperty("userAgent");

      // The serialiser must be handed to initQuery() so writeOne() maps the
      // returned session onto a typed object.
      expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: expect.anything() });
    });

    it("creates a session with attribution when none is open", async () => {
      neo4j.writeOne.mockImplementationOnce(async (q: any) => {
        written.push({ query: q.query, queryParams: q.queryParams });
        return { id: q.queryParams.newSessionId };
      });

      const result = await repository.recordPageView(input());

      const { query, queryParams } = written[0];
      expect(result).toEqual({ sessionId: queryParams!.newSessionId, created: true });
      expect(typeof queryParams!.newSessionId).toBe("string");
      expect(typeof queryParams!.pageViewId).toBe("string");

      expect(query).toContain("startedAt: datetime($receivedAt)");
      expect(query).toContain("utmSource: $utmSource");
      expect(query).toContain("landingRoute: $route");
      expect(query).toContain("deviceType: $deviceType");
      expect(query).toContain("consented: $consented");
      expect(query).toContain("referrerHost: $referrerHost");

      expect(queryParams).toMatchObject({
        consented: true,
        referrerHost: "linkedin.com",
        utmSource: "linkedin",
        utmMedium: "social",
        utmCampaign: "launch",
        utmTerm: null,
        utmContent: null,
        deviceType: "desktop",
      });
    });

    it("links the user only when userId is present", async () => {
      neo4j.writeOne.mockImplementationOnce(async (q: any) => {
        written.push({ query: q.query, queryParams: q.queryParams });
        return { id: "existing-session" };
      });

      await repository.recordPageView(input({ userId: "user-1" }));

      const { query, queryParams } = written[0];
      expect(query).toContain("OPTIONAL MATCH (user:User {id: $userId})");
      expect(query).toContain("MERGE (analyticsSession)-[:BY_USER]->(user)");
      expect(query).toContain("$userId IS NOT NULL");
      expect(query).toContain("NOT EXISTS { (analyticsSession)-[:BY_USER]->(:User) }");
      expect(queryParams).toMatchObject({ userId: "user-1" });
    });

    it("throws when the write returns no session", async () => {
      await expect(repository.recordPageView(input())).rejects.toThrow();
    });
  });

  describe("findForAdmin", () => {
    it("pages with {CURSOR} and filters by section/visitorId/userId", async () => {
      const cursor = { cursor: "0", take: 25 };
      await repository.findForAdmin({
        cursor,
        from: "2026-09-03T00:00:00.000Z",
        to: "2026-10-03T00:00:00.000Z",
        section: "public",
        visitorId: "d:abc",
      });

      expect(neo4j.readMany).toHaveBeenCalledTimes(1);
      const query = neo4j.readMany.mock.calls[0][0];

      expect(query.query).toContain("MATCH (analyticsSession:AnalyticsSession)");
      expect(query.query).toContain("analyticsSession.startedAt >= datetime($from)");
      expect(query.query).toContain("analyticsSession.startedAt <= datetime($to)");
      expect(query.query).toContain("($section = 'all' OR analyticsSession.section = $section)");
      expect(query.query).toContain("($visitorId IS NULL OR analyticsSession.visitorId = $visitorId)");
      expect(query.query).toContain(
        "($userId IS NULL OR EXISTS { (analyticsSession)-[:BY_USER]->(:User {id: $userId}) })",
      );
      expect(query.query).toContain("ORDER BY analyticsSession.startedAt DESC");
      expect(query.query).toContain("{CURSOR}");
      expect(query.query).toContain("OPTIONAL MATCH (analyticsSession)-[:BY_USER]->(analyticsSession_user:User)");
      expect(query.query.indexOf("{CURSOR}")).toBeLessThan(query.query.indexOf("RETURN analyticsSession"));

      expect(query.queryParams).toMatchObject({
        from: "2026-09-03T00:00:00.000Z",
        to: "2026-10-03T00:00:00.000Z",
        section: "public",
        visitorId: "d:abc",
        userId: null,
      });
      // The only companyId is the one initQuery seeded; this method never binds its own.
      expect(query.queryParams.companyId).toBe("company-1");
      expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: expect.anything(), cursor });
    });
  });

  describe("deleteDay", () => {
    it("deletes page views then sessions of that calendar day in batches of 1000", async () => {
      neo4j.executeInTransaction
        .mockResolvedValueOnce([{ records: [record({ deleted: int(1000) })] }])
        .mockResolvedValueOnce([{ records: [record({ deleted: int(4) })] }])
        .mockResolvedValueOnce([{ records: [record({ deleted: int(7) })] }]);

      const result = await repository.deleteDay({ date: "2025-09-01" });

      expect(result).toEqual({ sessions: 7, pageViews: 1004 });
      expect(neo4j.executeInTransaction).toHaveBeenCalledTimes(3);

      const calls = neo4j.executeInTransaction.mock.calls.map((c: any[]) => c[0][0]);
      for (const call of calls) {
        expect(call.query).toContain("date(analyticsSession.startedAt) = date($date)");
        expect(call.query).toContain("LIMIT toInteger($batchSize)");
        expect(call.query).toContain("DETACH DELETE");
        expect(call.params).toMatchObject({ date: "2025-09-01", batchSize: 1000 });
      }
      expect(calls[0].query).toContain("DETACH DELETE analyticsPageView");
      expect(calls[1].query).toContain("DETACH DELETE analyticsPageView");
      expect(calls[2].query).toContain("DETACH DELETE analyticsSession");
    });
  });

  describe("unlinkDeletedUsers", () => {
    it("removes BY_USER edges of soft-deleted users", async () => {
      neo4j.executeInTransaction.mockResolvedValueOnce([{ records: [record({ unlinked: int(3) })] }]);

      await expect(repository.unlinkDeletedUsers()).resolves.toBe(3);

      const call = neo4j.executeInTransaction.mock.calls[0][0][0];
      expect(call.query).toContain("MATCH (:AnalyticsSession)-[r:BY_USER]->(user:User {isDeleted: true})");
      expect(call.query).toContain("DELETE r");
    });
  });

  describe("findExpiredDays", () => {
    it("returns ascending distinct days before the cutoff, limited", async () => {
      neo4j.read.mockResolvedValueOnce({
        // The driver hands back Date components as Neo4j Integers.
        records: [
          record({ day: new Neo4jDate(int(2025), int(8), int(1)) }),
          record({ day: new Neo4jDate(int(2025), int(8), int(2)) }),
        ],
      });

      const days = await repository.findExpiredDays({ cutoff: "2025-09-03", limit: 31 });

      expect(days).toEqual(["2025-08-01", "2025-08-02"]);
      const [query, params] = neo4j.read.mock.calls[0];
      expect(query).toContain("date(analyticsSession.startedAt) < date($cutoff)");
      expect(query).toContain("DISTINCT");
      expect(query).toContain("ORDER BY day ASC");
      expect(query).toContain("LIMIT toInteger($limit)");
      expect(params).toEqual({ cutoff: "2025-09-03", limit: 31 });
    });
  });
});
