import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralAdminRepository } from "../repositories/referral.admin.repository";

const int = (n: number) => ({ toNumber: () => n });

function makeRecord(values: Record<string, unknown>) {
  return { get: (k: string) => values[k] };
}

function makeRepo() {
  const neo4j = {
    initQuery: vi.fn(() => ({ query: "MATCH (company:Company {id: $companyId})", queryParams: { companyId: "cls" } })),
    read: vi.fn(async () => ({ records: [] as any[] })),
  } as any;
  const repo = new ReferralAdminRepository(neo4j, {} as any, { get: () => "cls-company-id" } as any);
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

const FROM = "2026-10-01T00:00:00.000Z";
const PREVIOUS_FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-10-31T00:00:00.000Z";
const EXCLUDE = ["admin-user-1"];

const summaryRecord = (n: number) =>
  makeRecord({
    visits: int(n),
    invitesSent: int(n + 1),
    signups: int(n + 2),
    paying: int(n + 3),
    creditsGiven: int(n + 4),
    sharingCompanies: int(n + 5),
    eligibleCompanies: int(n + 6),
  });

describe("ReferralAdminRepository", () => {
  let repo: ReferralAdminRepository;
  let neo4j: any;

  beforeEach(() => {
    ({ repo, neo4j } = makeRepo());
  });

  it("the file opens with the cross-tenant exception header", () => {
    const source = readFileSync(join(__dirname, "../repositories/referral.admin.repository.ts"), "utf8");
    expect(source.split("\n")[0]).toBe("// nja-lint-ignore-file: cross-tenant administrative read repository.");
  });

  it("never uses initQuery and never binds companyId", async () => {
    const seen = capture(neo4j, () => [summaryRecord(0)]);

    await repo.findSummary({ from: FROM, previousFrom: PREVIOUS_FROM, to: TO, excludeUserIds: EXCLUDE });
    await repo.findReferrers({ from: FROM, sort: "paying", excludeUserIds: EXCLUDE });
    await repo.findReferrals({ from: FROM, excludeUserIds: EXCLUDE });

    expect(neo4j.initQuery).not.toHaveBeenCalled();
    for (const { q, p } of seen) {
      expect(p).not.toHaveProperty("companyId");
      expect(q).not.toContain("$companyId");
    }
  });

  it("findSummary returns current and previous", async () => {
    const seen = capture(neo4j, (_q, p) => [summaryRecord(p.from === FROM ? 10 : 20)]);

    const rows = await repo.findSummary({ from: FROM, previousFrom: PREVIOUS_FROM, to: TO, excludeUserIds: EXCLUDE });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "current",
      window: "current",
      visits: 10,
      invitesSent: 11,
      signups: 12,
      paying: 13,
      creditsGiven: 14,
      sharingCompanies: 15,
      eligibleCompanies: 16,
    });
    expect(rows[1]).toMatchObject({ id: "previous", window: "previous", visits: 20, eligibleCompanies: 26 });

    // previous = [previousFrom, from)
    const previous = seen.find((s) => s.p.from === PREVIOUS_FROM)!;
    expect(previous.p.to).toBe(FROM);
    const current = seen.find((s) => s.p.from === FROM)!;
    expect(current.p.to).toBe(TO);
  });

  it("findSummary with no start returns current only", async () => {
    const seen = capture(neo4j, () => [summaryRecord(1)]);

    const rows = await repo.findSummary({ from: null, previousFrom: null, to: TO, excludeUserIds: EXCLUDE });

    expect(rows).toHaveLength(1);
    expect(rows[0].window).toBe("current");
    expect(seen).toHaveLength(1);
    expect(seen[0].p.from).toBeNull();
  });

  it("counts use inclusive starts", async () => {
    const seen = capture(neo4j, () => [summaryRecord(0)]);

    await repo.findSummary({ from: FROM, previousFrom: null, to: TO, excludeUserIds: EXCLUDE });
    await repo.findReferrers({ from: FROM, sort: "paying", excludeUserIds: EXCLUDE });
    await repo.findReferrals({ from: FROM, excludeUserIds: EXCLUDE });

    for (const { q } of seen) expect(q).toContain(">= datetime($from)");
  });

  it("paying and credits come from completed referrals", async () => {
    const seen = capture(neo4j, () => [summaryRecord(0)]);

    await repo.findSummary({ from: FROM, previousFrom: null, to: TO, excludeUserIds: EXCLUDE });

    const q = seen[0].q;
    expect(q).toContain("status = 'completed'");
    expect(q).toContain("completedAt >= datetime($from)");
    expect(q).toMatch(/2 \* sum\(coalesce\(\w+\.tokensAwarded, 0\)\)/);
  });

  it("administrators and demo companies are excluded", async () => {
    const seen = capture(neo4j, () => [summaryRecord(0)]);

    await repo.findSummary({ from: FROM, previousFrom: null, to: TO, excludeUserIds: EXCLUDE });
    await repo.findReferrers({ from: FROM, sort: "paying", excludeUserIds: EXCLUDE });
    await repo.findReferrals({ from: FROM, excludeUserIds: EXCLUDE });

    for (const { q, p } of seen) {
      expect(p.excludeUserIds).toEqual(EXCLUDE);
      expect(q).toContain("IN $excludeUserIds");
      expect(q).toContain(".isDemo, false) = false");
    }

    // Referrals are filtered on both sides: the referrer and the referred company.
    const referrals = seen[seen.length - 1].q;
    expect(referrals).toMatch(/MATCH \(\w+:User\)-\[:BELONGS_TO\]->\(referral_referrer\)/);
    expect(referrals).toMatch(/MATCH \(\w+:User\)-\[:BELONGS_TO\]->\(referral_referred\)/);
  });

  it("findReferrers keeps companies with visits only", async () => {
    capture(neo4j, () => [
      makeRecord({
        id: "company-1",
        name: "Ada",
        email: "ada@example.com",
        visits: int(3),
        invitesSent: int(0),
        signupsLink: int(0),
        signupsDirect: int(0),
        paying: int(0),
        creditsEarned: int(0),
        lastInviteAt: null,
      }),
    ]);

    const rows = await repo.findReferrers({ from: FROM, sort: "paying", excludeUserIds: EXCLUDE });

    expect(rows).toEqual([
      {
        id: "company-1",
        name: "Ada",
        email: "ada@example.com",
        visits: 3,
        invitesSent: 0,
        signupsLink: 0,
        signupsDirect: 0,
        paying: 0,
        creditsEarned: 0,
        lastInviteAt: undefined,
      },
    ]);
  });

  it("findReferrers selects companies with a visit, an invite or a referral", async () => {
    const seen = capture(neo4j);

    await repo.findReferrers({ from: FROM, sort: "paying", excludeUserIds: EXCLUDE });

    const q = seen[0].q;
    expect(q).toContain(":ReferralVisit)-[:VISITED]->");
    expect(q).toContain(":ReferralInvite)-[:SENT_BY]->");
    expect(q).toContain(":Referral)-[:REFERRED_BY]->");
    expect(q).toContain("UNION");
  });

  it("findReferrers orders by the allowlisted clause", async () => {
    const seen = capture(neo4j);

    await repo.findReferrers({ from: FROM, sort: "conversion", excludeUserIds: EXCLUDE });

    const q = seen[0].q;
    expect(q).toContain("ORDER BY conversion DESC, paying DESC");
    expect(q).toContain("CASE WHEN invitesSent = 0 THEN 0.0 ELSE toFloat(paying) / invitesSent END AS conversion");
  });

  it("findReferrers falls back to paying for a value outside the allowlist", async () => {
    const seen = capture(neo4j);

    await repo.findReferrers({ from: FROM, sort: "'; DETACH DELETE n //" as any, excludeUserIds: EXCLUDE });

    expect(seen[0].q).toContain("ORDER BY paying DESC, signups DESC");
    expect(seen[0].q).not.toContain("DETACH DELETE");
  });

  it("findReferrers maps a company without users to empty strings", async () => {
    capture(neo4j, () => [
      makeRecord({
        id: "company-2",
        name: null,
        email: null,
        visits: int(0),
        invitesSent: int(1),
        signupsLink: int(0),
        signupsDirect: int(0),
        paying: int(0),
        creditsEarned: int(0),
        lastInviteAt: "2026-10-10T10:00:00.000Z",
      }),
    ]);

    const [row] = await repo.findReferrers({ from: null, sort: "paying", excludeUserIds: EXCLUDE });

    expect(row.name).toBe("");
    expect(row.email).toBe("");
    expect(row.invitesSent).toBe(1);
    expect(row.lastInviteAt).toEqual(new Date("2026-10-10T10:00:00.000Z"));
  });

  it("findReferrals maps source, status and datetimes", async () => {
    const seen = capture(neo4j, () => [
      makeRecord({
        id: "referral-1",
        name: "New",
        email: "new@example.com",
        referrerName: "Old",
        referrerEmail: "old@example.com",
        source: "link",
        status: "completed",
        referredAt: "2026-10-05T09:00:00.000Z",
        completedAt: "2026-10-06T09:00:00.000Z",
        tokensAwarded: int(1000),
      }),
      makeRecord({
        id: "referral-2",
        name: null,
        email: null,
        referrerName: null,
        referrerEmail: null,
        source: "direct",
        status: "pending",
        referredAt: "2026-10-04T09:00:00.000Z",
        completedAt: null,
        tokensAwarded: null,
      }),
    ]);

    const rows = await repo.findReferrals({ from: FROM, excludeUserIds: EXCLUDE });

    expect(rows[0]).toEqual({
      id: "referral-1",
      name: "New",
      email: "new@example.com",
      referrerName: "Old",
      referrerEmail: "old@example.com",
      source: "link",
      status: "completed",
      referredAt: new Date("2026-10-05T09:00:00.000Z"),
      completedAt: new Date("2026-10-06T09:00:00.000Z"),
      tokensAwarded: 1000,
    });
    expect(rows[1]).toMatchObject({ name: "", email: "", referrerName: "", referrerEmail: "", source: "direct" });
    expect(rows[1].completedAt).toBeUndefined();
    expect(rows[1].tokensAwarded).toBeUndefined();
    expect(seen[0].q).toContain("ORDER BY referral.createdAt DESC");
  });

  it("a referral written before source existed stays unknown", async () => {
    const seen = capture(neo4j, () => [
      makeRecord({
        id: "referral-3",
        name: "Old",
        email: "old@example.com",
        referrerName: "Older",
        referrerEmail: "older@example.com",
        source: null,
        status: "pending",
        referredAt: "2026-10-04T09:00:00.000Z",
        completedAt: null,
        tokensAwarded: null,
      }),
    ]);

    const rows = await repo.findReferrals({ from: FROM, excludeUserIds: EXCLUDE });

    expect(rows[0].source).toBe("");
    expect(seen[0].q).not.toContain("coalesce(referral.source, $directSource)");
  });

  it("findReferrers counts an unknown source in neither split", async () => {
    const seen = capture(neo4j, () => []);

    await repo.findReferrers({ from: FROM, sort: "paying", excludeUserIds: EXCLUDE });

    expect(seen[0].q).toContain("signup.source = $directSource THEN 1 END) AS signupsDirect");
    expect(seen[0].q).not.toContain("signup.source IS NULL");
  });
});
