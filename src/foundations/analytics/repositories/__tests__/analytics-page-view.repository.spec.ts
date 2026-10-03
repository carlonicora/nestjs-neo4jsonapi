import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsPageViewRepository } from "../analytics-page-view.repository";

describe("AnalyticsPageViewRepository", () => {
  let repository: AnalyticsPageViewRepository;
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

    repository = new AnalyticsPageViewRepository(neo4j, securityService, cls);
  });

  it("creates analyticsPageView_createdAt index", async () => {
    await repository.onModuleInit();

    expect(written.map((w) => w.query)).toContain(
      "CREATE INDEX analyticsPageView_createdAt IF NOT EXISTS FOR (analyticsPageView:AnalyticsPageView) ON (analyticsPageView.createdAt)",
    );
  });

  it("findBySession orders ascending", async () => {
    await repository.findBySession({ sessionId: "session-1" });

    expect(neo4j.readMany).toHaveBeenCalledTimes(1);
    const query = neo4j.readMany.mock.calls[0][0];

    expect(query.query).toContain("MATCH (analyticsPageView:AnalyticsPageView)");
    expect(query.query).toContain("MATCH (analyticsPageView)-[:IN_SESSION]->(:AnalyticsSession {id: $sessionId})");
    expect(query.query).toContain("ORDER BY analyticsPageView.createdAt ASC");
    expect(query.query.indexOf("RETURN analyticsPageView")).toBeLessThan(
      query.query.indexOf("ORDER BY analyticsPageView.createdAt ASC"),
    );
    expect(query.queryParams).toMatchObject({ sessionId: "session-1" });
    expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: expect.anything() });
  });
});
