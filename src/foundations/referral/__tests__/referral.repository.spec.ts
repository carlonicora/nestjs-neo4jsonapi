import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClsService } from "nestjs-cls";
import { ReferralRepository } from "../repositories/referral.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";

describe("ReferralRepository", () => {
  let repository: ReferralRepository;
  let neo4j: {
    initQuery: ReturnType<typeof vi.fn>;
    writeOne: ReturnType<typeof vi.fn>;
    executeInTransaction: ReturnType<typeof vi.fn>;
    validateRelatedNodes: ReturnType<typeof vi.fn>;
  };

  const REFERRER_ID = "referrer-company";
  const REFERRED_ID = "referred-company";

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, unknown> })),
      writeOne: vi.fn().mockResolvedValue(undefined),
      executeInTransaction: vi.fn().mockResolvedValue([{ records: [{}] }]),
      validateRelatedNodes: vi.fn().mockResolvedValue(undefined),
    };
    repository = new ReferralRepository(
      neo4j as unknown as Neo4jService,
      {} as SecurityService,
      { has: vi.fn(), get: vi.fn() } as unknown as ClsService,
    );
  });

  it("createReferral validates the referred company only", async () => {
    await repository.createReferral({
      id: "r1",
      referrerCompanyId: REFERRER_ID,
      referredCompanyId: REFERRED_ID,
      source: "link",
    });

    expect(neo4j.validateRelatedNodes).toHaveBeenCalledTimes(1);
    expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({
      nodes: [{ id: REFERRED_ID, label: "Company" }],
    });
    expect(JSON.stringify(neo4j.validateRelatedNodes.mock.calls)).not.toContain(REFERRER_ID);
  });

  it("createReferral and createReferralIfAbsent write source", async () => {
    await repository.createReferral({
      id: "r1",
      referrerCompanyId: REFERRER_ID,
      referredCompanyId: REFERRED_ID,
      source: "link",
    });
    const [[txQuery]] = neo4j.executeInTransaction.mock.calls[0];
    expect(txQuery.query).toContain("source: $source");
    expect(txQuery.params.source).toBe("link");

    await repository.createReferralIfAbsent({
      id: "r2",
      referrerCompanyId: REFERRER_ID,
      referredCompanyId: REFERRED_ID,
      source: "direct",
    });
    const written = neo4j.writeOne.mock.calls[0][0] as { query: string; queryParams: Record<string, unknown> };
    expect(written.query).toContain("source: $source");
    expect(written.queryParams.source).toBe("direct");
  });

  it("createInvite links company and user", async () => {
    await repository.createInvite({ id: "i1", companyId: "company-a", userId: "user-a" });

    expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({
      nodes: [
        { id: "company-a", label: "Company" },
        { id: "user-a", label: "User" },
      ],
    });
    const written = neo4j.writeOne.mock.calls[0][0] as { query: string; queryParams: Record<string, unknown> };
    expect(written.query).toContain(":ReferralInvite");
    expect(written.query).toContain("-[:SENT_BY]->");
    expect(written.query).toContain("-[:SENT_BY_USER]->");
    expect(written.query).toContain("createdAt: datetime()");
    expect(written.queryParams).toEqual(
      expect.objectContaining({ id: "i1", companyId: "company-a", userId: "user-a" }),
    );
    expect(written.queryParams).not.toHaveProperty("email");
  });

  it("createVisit links the code owner", async () => {
    await repository.createVisit({ id: "v1", referrerCompanyId: "company-a" });

    expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({
      nodes: [{ id: "company-a", label: "Company" }],
    });
    const written = neo4j.writeOne.mock.calls[0][0] as { query: string; queryParams: Record<string, unknown> };
    expect(written.query).toContain(":ReferralVisit");
    expect(written.query).toContain("-[:VISITED]->");
    expect(written.query).toContain("createdAt: datetime()");
    expect(written.queryParams).toEqual(expect.objectContaining({ id: "v1", referrerCompanyId: "company-a" }));
  });
});
