import { int, isInt } from "neo4j-driver";
import { ClsService } from "nestjs-cls";
import type { Mocked } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { ELIGIBLE_RECIPIENTS_CYPHER } from "../email-blast.constants";
import { EmailBlastDescriptor } from "../entities/email-blast";
import { EmailBlastDeliveryDescriptor } from "../entities/email-blast-delivery";
import { EmailBlastAdminRepository } from "../repositories/email-blast.admin.repository";
import { EmailBlastDeliveryRepository } from "../repositories/email-blast-delivery.repository";
import { EmailBlastRepository } from "../repositories/email-blast.repository";

type IssuedQuery = { query: string; queryParams: Record<string, unknown> };

describe("email-blast repositories", () => {
  // Simulates the prefix Neo4jService.initQuery() emits on an authenticated request:
  // custom Cypher must be appended to it, never assigned over it.
  const initQueryPrefix = "MATCH (currentUser:User {id: $currentUserId})\n";

  let neo4j: Mocked<Neo4jService>;
  let securityService: Mocked<SecurityService>;
  let cls: Mocked<ClsService>;
  let blastRepository: EmailBlastRepository;
  let deliveryRepository: EmailBlastDeliveryRepository;
  let adminRepository: EmailBlastAdminRepository;

  const lastCall = (calls: unknown[][]): IssuedQuery => calls[calls.length - 1][0] as IssuedQuery;
  const lastWriteOne = (): IssuedQuery => lastCall(neo4j.writeOne.mock.calls);
  const lastWriteMany = (): IssuedQuery => lastCall(neo4j.writeAndReturnMany.mock.calls);

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn((params?: any) => ({
        query: initQueryPrefix,
        queryParams: { companyId: null, currentUserId: "user-1" },
        cursor: params?.cursor,
        serialiser: params?.serialiser,
        fetchAll: params?.fetchAll,
      })),
      readOne: vi.fn(async () => null),
      readMany: vi.fn(async () => []),
      writeOne: vi.fn(async () => null),
      writeAndReturnMany: vi.fn(async () => null),
      read: vi.fn(async () => ({ records: [] })),
      executeInTransaction: vi.fn(async () => []),
    } as unknown as Mocked<Neo4jService>;
    securityService = {} as unknown as Mocked<SecurityService>;
    cls = { get: vi.fn(() => undefined), has: vi.fn(() => false) } as unknown as Mocked<ClsService>;

    blastRepository = new EmailBlastRepository(neo4j, securityService, cls);
    deliveryRepository = new EmailBlastDeliveryRepository(neo4j, securityService, cls);
    adminRepository = new EmailBlastAdminRepository(neo4j, securityService, cls);
  });

  const at = new Date("2026-10-27T10:00:00.000Z");

  it("markSending only matches a draft", async () => {
    const blast = { id: "blast-1" } as never;
    neo4j.writeOne.mockResolvedValueOnce(blast);

    const result = await blastRepository.markSending({ id: "blast-1", sentAt: at });

    const issued = lastWriteOne();
    expect(result).toBe(blast);
    expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
    expect(issued.query).toContain('emailBlast.status = "draft"');
    expect(issued.query).toContain('emailBlast.status = "sending"');
    expect(issued.query).toContain("datetime($sentAt)");
    expect(issued.queryParams).toMatchObject({ searchValue: "blast-1", sentAt: at.toISOString() });
    expect(neo4j.initQuery).toHaveBeenCalledWith(expect.objectContaining({ serialiser: EmailBlastDescriptor.model }));
  });

  it("writes go through write transactions", async () => {
    await blastRepository.markSending({ id: "b", sentAt: at });
    await blastRepository.markSentIfDone({ id: "b" });
    await deliveryRepository.claimBatch({ blastId: "b", limit: 50, claimedAt: at });
    await deliveryRepository.markSent({ id: "d", sentAt: at });
    await deliveryRepository.markFailed({ id: "d", error: "boom" });
    await deliveryRepository.markSkipped({ id: "d" });
    await deliveryRepository.failStuck({ claimedBefore: at });
    await deliveryRepository.markUnsubscribed({ id: "d", unsubscribedAt: at });

    expect(neo4j.readOne).not.toHaveBeenCalled();
    expect(neo4j.readMany).not.toHaveBeenCalled();
    expect(neo4j.read).not.toHaveBeenCalled();
    expect(neo4j.writeOne.mock.calls.length + neo4j.writeAndReturnMany.mock.calls.length).toBe(8);
    for (const [issued] of [...neo4j.writeOne.mock.calls, ...neo4j.writeAndReturnMany.mock.calls]) {
      expect((issued as IssuedQuery).query.startsWith(initQueryPrefix)).toBe(true);
    }
  });

  it("temporal params are ISO strings", async () => {
    await blastRepository.markSending({ id: "b", sentAt: at });
    expect(lastWriteOne().queryParams.sentAt).toBe(at.toISOString());

    await deliveryRepository.markSent({ id: "d", sentAt: at });
    expect(lastWriteOne().queryParams.sentAt).toBe(at.toISOString());

    await deliveryRepository.claimBatch({ blastId: "b", limit: 50, claimedAt: at });
    expect(lastWriteMany().queryParams.claimedAt).toBe(at.toISOString());

    await deliveryRepository.failStuck({ claimedBefore: at });
    expect(lastWriteMany().queryParams.claimedBefore).toBe(at.toISOString());
    expect(lastWriteMany().query).toContain("datetime($claimedBefore)");

    await deliveryRepository.markUnsubscribed({ id: "d", unsubscribedAt: at });
    expect(lastWriteOne().queryParams.unsubscribedAt).toBe(at.toISOString());
    expect(lastWriteOne().query).toContain("datetime($unsubscribedAt)");
  });

  it("markSentIfDone requires no pending or sending delivery", async () => {
    await blastRepository.markSentIfDone({ id: "blast-1" });

    const issued = lastWriteOne();
    expect(issued.query).toMatch(/NOT EXISTS \{\s*MATCH \(emailBlast\)-\[:HAS_DELIVERY\]->/);
    expect(issued.query).toContain('["pending", "sending"]');
    expect(issued.query).toContain('emailBlast.status = "sending"');
    expect(issued.query).toContain('emailBlast.status = "sent"');
  });

  it("findSending reads sending blasts", async () => {
    await blastRepository.findSending();

    const issued = lastCall(neo4j.readMany.mock.calls);
    expect(issued.query).toContain('emailBlast.status = "sending"');
  });

  it("createSnapshot groups recipients by lower-cased email", async () => {
    await deliveryRepository.createSnapshot({ blastId: "blast-1" });

    expect(neo4j.initQuery).not.toHaveBeenCalled();
    expect(neo4j.executeInTransaction).toHaveBeenCalledTimes(1);
    const [[entry]] = neo4j.executeInTransaction.mock.calls[0] as unknown as [[{ query: string; params: any }]];
    expect(entry.query).toContain(ELIGIBLE_RECIPIENTS_CYPHER);
    expect(entry.query).toContain("toLower(candidate.email)");
    expect(entry.query).toContain("collect(candidate)[0]");
    expect(entry.query).toMatch(/WHERE NOT EXISTS \{\s*MATCH \(emailBlast\)-\[:HAS_DELIVERY\]->/);
    expect(entry.query).toContain("recipientCount");
    expect(entry.query).toContain("userId: row.recipient.id");
    expect(entry.query).not.toContain("`");
    expect(entry.params).toEqual({ blastId: "blast-1" });
    expect(entry.params).not.toHaveProperty("companyId");
  });

  it("createSnapshot sets recipientCount to size(rows) from a collected CALL", async () => {
    await deliveryRepository.createSnapshot({ blastId: "blast-1" });

    const [[entry]] = neo4j.executeInTransaction.mock.calls[0] as unknown as [[{ query: string }]];
    const callStart = entry.query.indexOf("CALL {");
    expect(callStart).toBeGreaterThan(-1);
    expect(entry.query.indexOf("collect({ email: email, recipient: recipient }) AS rows")).toBeGreaterThan(callStart);
    expect(entry.query).toContain("FOREACH (row IN rows |");
    expect(entry.query).toContain("emailBlast.recipientCount = size(rows)");
  });

  it("claimBatch binds an integer limit", async () => {
    const result = await deliveryRepository.claimBatch({ blastId: "blast-1", limit: 50, claimedAt: at });

    const issued = lastWriteMany();
    expect(result).toEqual([]);
    expect(isInt(issued.queryParams.limit)).toBe(true);
    expect((issued.queryParams.limit as ReturnType<typeof int>).toNumber()).toBe(50);
    expect(issued.query).toContain("LIMIT $limit");
    expect(issued.query).toContain('emailBlastDelivery.status = "pending"');
    expect(issued.query).toContain('emailBlastDelivery.status = "sending"');
    expect(issued.query).toContain("datetime($claimedAt)");
    expect(issued.queryParams.blastId).toBe("blast-1");
    expect(neo4j.initQuery).toHaveBeenCalledWith(
      expect.objectContaining({ serialiser: EmailBlastDeliveryDescriptor.model }),
    );
  });

  it("markSent / markFailed / markSkipped only move a sending delivery", async () => {
    await deliveryRepository.markSent({ id: "d", sentAt: at });
    const sent = lastWriteOne().query;
    expect(sent).toContain('emailBlastDelivery.status = "sending"');
    expect(sent).toContain('emailBlastDelivery.status = "sent"');
    expect(sent).toContain("countedBlast.sentCount = coalesce(countedBlast.sentCount, 0) + 1");

    await deliveryRepository.markFailed({ id: "d", error: "boom" });
    const failed = lastWriteOne();
    expect(failed.query).toContain('emailBlastDelivery.status = "sending"');
    expect(failed.query).toContain('emailBlastDelivery.status = "failed"');
    expect(failed.query).toContain("countedBlast.failedCount = coalesce(countedBlast.failedCount, 0) + 1");
    expect(failed.queryParams.error).toBe("boom");

    await deliveryRepository.markSkipped({ id: "d" });
    const skipped = lastWriteOne().query;
    expect(skipped).toContain('emailBlastDelivery.status = "sending"');
    expect(skipped).toContain('emailBlastDelivery.status = "skipped"');
    expect(skipped).not.toContain("Count");
  });

  it("failStuck raises failedCount in the same query", async () => {
    await deliveryRepository.failStuck({ claimedBefore: at });

    expect(neo4j.writeAndReturnMany).toHaveBeenCalledTimes(1);
    const issued = lastWriteMany();
    expect(issued.query).toContain('emailBlastDelivery.status = "sending"');
    expect(issued.query).toContain("emailBlastDelivery.claimedAt < datetime($claimedBefore)");
    expect(issued.query).toContain('emailBlastDelivery.status = "failed"');
    expect(issued.query).toContain('emailBlastDelivery.error = "stuck"');
    expect(issued.query).toContain("countedBlast.failedCount = coalesce(countedBlast.failedCount, 0) + 1");
  });

  it("markUnsubscribed only matches when unsubscribedAt IS NULL and raises unsubscribedCount in the same query", async () => {
    neo4j.writeOne.mockResolvedValueOnce({ id: "d" } as never);
    await expect(deliveryRepository.markUnsubscribed({ id: "d", unsubscribedAt: at })).resolves.toBe(true);

    const issued = lastWriteOne();
    expect(issued.query).toContain("emailBlastDelivery.unsubscribedAt IS NULL");
    expect(issued.query).toContain("countedBlast.unsubscribedCount = coalesce(countedBlast.unsubscribedCount, 0) + 1");

    await expect(deliveryRepository.markUnsubscribed({ id: "d", unsubscribedAt: at })).resolves.toBe(false);
  });

  it("findByUnsubscribeToken reads by token with the blast included", async () => {
    await deliveryRepository.findByUnsubscribeToken({ token: "tok" });

    const issued = lastCall(neo4j.readOne.mock.calls);
    expect(issued.query).toContain("{unsubscribeToken: $searchValue}");
    expect(issued.query).toContain("HAS_DELIVERY");
    expect(issued.query).toContain("emailBlastDelivery_blast");
    expect(issued.queryParams.searchValue).toBe("tok");
  });

  it("counter-changing writes lock then re-check", async () => {
    const cases: { run: () => Promise<unknown>; issued: () => IssuedQuery; guard: string }[] = [
      {
        run: () => blastRepository.markSending({ id: "b", sentAt: at }),
        issued: lastWriteOne,
        guard: 'WHERE emailBlast.status = "draft"',
      },
      {
        run: () => deliveryRepository.markUnsubscribed({ id: "d", unsubscribedAt: at }),
        issued: lastWriteOne,
        guard: "WHERE emailBlastDelivery.unsubscribedAt IS NULL",
      },
      {
        run: () => deliveryRepository.markSent({ id: "d", sentAt: at }),
        issued: lastWriteOne,
        guard: 'WHERE emailBlastDelivery.status = "sending"',
      },
      {
        run: () => deliveryRepository.markFailed({ id: "d", error: "e" }),
        issued: lastWriteOne,
        guard: 'WHERE emailBlastDelivery.status = "sending"',
      },
    ];

    for (const testCase of cases) {
      await testCase.run();
      const query = testCase.issued().query;
      const lock = query.indexOf("._lock = true");
      expect(lock).toBeGreaterThan(-1);
      expect(query.indexOf(testCase.guard)).toBeGreaterThan(lock);
    }

    await deliveryRepository.failStuck({ claimedBefore: at });
    const stuck = lastWriteMany().query;
    const lock = stuck.indexOf("emailBlastDelivery._lock = true");
    expect(lock).toBeGreaterThan(-1);
    expect(stuck.indexOf('WHERE emailBlastDelivery.status = "sending"', lock)).toBeGreaterThan(lock);
    // The blast's lock is taken before its counter is read.
    expect(stuck.indexOf("countedBlast._lock = true")).toBeLessThan(stuck.indexOf("countedBlast.failedCount"));
  });

  it("countEligibleRecipients is seeded without initQuery", async () => {
    neo4j.read.mockResolvedValueOnce({
      records: [{ get: (key: string) => (key === "recipientCount" ? int(3) : null) }],
    });

    const result = await adminRepository.countEligibleRecipients({ blastId: "blast-1" });

    expect(result).toEqual({ id: "blast-1", recipientCount: 3 });
    expect(neo4j.initQuery).not.toHaveBeenCalled();
    const [query, params] = neo4j.read.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toContain(ELIGIBLE_RECIPIENTS_CYPHER);
    expect(query).toContain("RETURN count(email) AS recipientCount");
    expect(params).not.toHaveProperty("companyId");
  });
});
