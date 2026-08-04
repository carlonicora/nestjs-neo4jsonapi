import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserActivityRepository } from "../user-activity.repository";

describe("UserActivityRepository", () => {
  let repository: UserActivityRepository;
  let neo4j: any;
  let written: Array<{ query: string; queryParams?: Record<string, unknown> }>;

  // Simulates the prefix Neo4jService.initQuery() emits on every authenticated
  // request (CLS holds companyId/userId).
  const initQueryPrefix = "MATCH (company:Company {id: $companyId})\n";

  beforeEach(() => {
    written = [];
    neo4j = {
      initQuery: vi.fn(() => ({ query: initQueryPrefix, queryParams: {} })),
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

    repository = new UserActivityRepository(neo4j, securityService, cls);
  });

  describe("onModuleInit", () => {
    it("creates the two activity-log indexes on top of the descriptor constraints", async () => {
      await repository.onModuleInit();

      const queries = written.map((w) => w.query);

      expect(
        queries.some((q) =>
          q.includes("CREATE INDEX userActivity_createdAt IF NOT EXISTS FOR (userActivity:UserActivity)"),
        ),
      ).toBe(true);
      expect(
        queries.some((q) =>
          q.includes("CREATE INDEX userActivity_category_action IF NOT EXISTS FOR (userActivity:UserActivity)"),
        ),
      ).toBe(true);
      expect(queries.some((q) => q.includes("ON (userActivity.createdAt)"))).toBe(true);
      expect(queries.some((q) => q.includes("ON (userActivity.category, userActivity.action)"))).toBe(true);
    });
  });

  describe("createActivity", () => {
    it("writes both graph edges: (user)-[:PERFORMED]->(ua)-[:BELONGS_TO]->(company)", async () => {
      await repository.createActivity({
        userId: "user-1",
        companyId: "company-1",
        category: "ENTITY",
        action: "CREATE",
        entityType: "proceedings",
        entityId: "proc-1",
        metadata: { method: "POST", path: "/proceedings" },
      });

      expect(written).toHaveLength(1);
      const { query, queryParams } = written[0];

      // Explicit MATCHes: the worker runs outside HTTP/CLS context, so company
      // scoping cannot come from buildDefaultMatch().
      expect(query).toContain("MATCH (user:User {id: $userId})");
      expect(query).toContain("MATCH (companyTarget:Company {id: $companyId})");
      expect(query).toContain("CREATE (userActivity:UserActivity {");
      expect(query).toContain("CREATE (user)-[:PERFORMED]->(userActivity)");
      expect(query).toContain("CREATE (userActivity)-[:BELONGS_TO]->(companyTarget)");

      // Temporal columns are written with Cypher datetime() literals, never
      // as strings.
      expect(query).toContain("createdAt: datetime()");
      expect(query).toContain("updatedAt: datetime()");

      expect(queryParams).toMatchObject({
        userId: "user-1",
        companyId: "company-1",
        category: "ENTITY",
        action: "CREATE",
        entityType: "proceedings",
        entityId: "proc-1",
        metadata: '{"method":"POST","path":"/proceedings"}',
      });
      expect(typeof queryParams!.id).toBe("string");
    });

    it("nulls out the optional columns and stores metadata as a JSON string", async () => {
      await repository.createActivity({
        userId: "user-1",
        companyId: "company-1",
        category: "AUTH",
        action: "LOGIN",
      });

      expect(written[0].queryParams).toMatchObject({
        entityType: null,
        entityId: null,
        metadata: null,
      });
    });
  });

  describe("findByUser", () => {
    it("traverses the PERFORMED edge, filters by date range and returns typed objects", async () => {
      const from = new Date("2026-01-01T00:00:00.000Z");
      const to = new Date("2026-02-01T00:00:00.000Z");

      await repository.findByUser({ userId: "user-1", from, to, limit: 25 });

      expect(neo4j.readMany).toHaveBeenCalledTimes(1);
      const query = neo4j.readMany.mock.calls[0][0];

      expect(query.query).toContain("MATCH (user:User {id: $userId})-[:PERFORMED]->(userActivity:UserActivity)");
      expect(query.query).toContain("($from IS NULL OR userActivity.createdAt >= datetime($from))");
      expect(query.query).toContain("($to IS NULL OR userActivity.createdAt < datetime($to))");
      expect(query.query).toContain("ORDER BY userActivity.createdAt DESC");
      expect(query.query).toContain("LIMIT toInteger($limit)");

      expect(query.queryParams).toMatchObject({
        userId: "user-1",
        from: from.toISOString(),
        to: to.toISOString(),
        limit: 25,
      });

      // The serialiser must be handed to initQuery(), or readMany() cannot map
      // records onto UserActivity objects.
      expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: expect.anything() });
    });

    it("defaults the date bounds to null and the limit to 100", async () => {
      await repository.findByUser({ userId: "user-1" });

      expect(neo4j.readMany.mock.calls[0][0].queryParams).toMatchObject({
        from: null,
        to: null,
        limit: 100,
      });
    });
  });
});
