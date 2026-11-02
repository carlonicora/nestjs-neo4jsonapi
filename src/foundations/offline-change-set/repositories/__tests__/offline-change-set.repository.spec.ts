import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineChangeSetRepository } from "../offline-change-set.repository";

describe("OfflineChangeSetRepository.deleteOlderThan", () => {
  let neo4j: any;
  let cls: Record<string, unknown>;
  let repository: OfflineChangeSetRepository;

  beforeEach(() => {
    cls = { companyId: "company-1", userId: "user-1" };
    neo4j = {
      initQuery: vi.fn(() => ({
        query: "MATCH (company:Company {id: $companyId})",
        queryParams: { companyId: cls.companyId ?? null, currentUserId: cls.userId ?? null },
      })),
      writeOne: vi.fn(async () => null),
    };
    const clsService = { get: (key: string) => cls[key], has: (key: string) => key in cls } as any;
    repository = new OfflineChangeSetRepository(neo4j, {} as any, clsService);
  });

  it("deletes the company's change sets created before the cut-off, with a parameterized, company-scoped query", async () => {
    await repository.deleteOlderThan({ before: new Date("2026-11-01T12:00:00Z") });

    expect(neo4j.initQuery).toHaveBeenCalledWith(expect.objectContaining({ serialiser: expect.anything() }));
    const query = neo4j.writeOne.mock.calls[0][0];
    expect(query.queryParams).toMatchObject({ companyId: "company-1", before: "2026-11-01T12:00:00.000Z" });
    expect(query.query).toContain("MATCH (offlineChangeSet:OfflineChangeSet)");
    expect(query.query).toContain("MATCH (offlineChangeSet)-[:BELONGS_TO]-(company)");
    expect(query.query).toContain("offlineChangeSet.createdAt < datetime($before)");
    expect(query.query).toContain("DETACH DELETE offlineChangeSet");
    expect(query.query).not.toContain("2026-11-01");
  });

  it("without a company in the request it deletes nothing (never every company's)", async () => {
    delete cls.companyId;
    await repository.deleteOlderThan({ before: new Date("2026-11-01T12:00:00Z") });
    expect(neo4j.writeOne).not.toHaveBeenCalled();
  });
});
