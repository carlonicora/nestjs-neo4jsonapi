import { int, isInt } from "neo4j-driver";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDeletionWipeRepository } from "./account-deletion.wipe.repository";

const USER_ID = "4f1c2a9e-0000-4000-8000-000000000001";
const COMPANY_ID = "4f1c2a9e-0000-4000-8000-000000000002";
const EMAIL = "gm@example.com";

const deletedResult = (deleted: number) => ({
  records: [{ get: (key: string) => (key === "deleted" ? int(deleted) : null) }],
});

type Call = { query: string; params: Record<string, unknown> };

describe("AccountDeletionWipeRepository", () => {
  let neo4j: { executeInTransaction: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> };
  let repository: AccountDeletionWipeRepository;
  let calls: Call[];
  let firstQuery: string | undefined;
  let sequence: number[];

  beforeEach(() => {
    calls = [];
    firstQuery = undefined;
    sequence = [1000, 1000, 3, 0];
    neo4j = {
      // The first distinct query gets 1000, 1000, 3, 0; every other query deletes nothing.
      executeInTransaction: vi.fn(async ([entry]: { query: string; params: Record<string, unknown> }[]) => {
        calls.push({ query: entry.query, params: entry.params });
        if (firstQuery === undefined) firstQuery = entry.query;
        if (entry.query === firstQuery && sequence.length > 0) return [deletedResult(sequence.shift()!)];
        return [deletedResult(0)];
      }),
      read: vi.fn(),
    };
    repository = new AccountDeletionWipeRepository(neo4j as never, {} as never, {} as never);
  });

  const bulkMethods: { name: string; run: () => Promise<void>; idParam: "userId" | "companyId" | null }[] = [
    {
      name: "deleteCompanyNodes",
      run: () => repository.deleteCompanyNodes({ companyId: COMPANY_ID, batchSize: 1000 }),
      idParam: "companyId",
    },
    {
      name: "deleteUserLinkedNodes",
      run: () => repository.deleteUserLinkedNodes({ userId: USER_ID, batchSize: 1000 }),
      idParam: "userId",
    },
    {
      name: "detachUserFromForeignNodes",
      run: () => repository.detachUserFromForeignNodes({ userId: USER_ID, batchSize: 1000 }),
      idParam: "userId",
    },
    {
      name: "deleteEmailKeyed",
      run: () => repository.deleteEmailKeyed({ email: EMAIL, userId: USER_ID, batchSize: 1000 }),
      idParam: "userId",
    },
    {
      name: "deleteStripeNodes",
      run: () => repository.deleteStripeNodes({ companyId: COMPANY_ID, batchSize: 1000 }),
      idParam: "companyId",
    },
    {
      name: "deleteDisconnectedKnowledge",
      run: () => repository.deleteDisconnectedKnowledge({ batchSize: 1000 }),
      idParam: null,
    },
  ];

  describe.each(bulkMethods)("$name", ({ run, idParam }) => {
    it("loops until a batch deletes 0", async () => {
      await run();

      const firstRuns = calls.filter((call) => call.query === firstQuery);
      expect(firstRuns).toHaveLength(4);
      for (const call of calls) {
        expect(isInt(call.params.batchSize)).toBe(true);
        expect((call.params.batchSize as ReturnType<typeof int>).toNumber()).toBe(1000);
        expect(call.query).toContain("LIMIT $batchSize");
      }
    });

    it("never interpolates ids", async () => {
      await run();

      for (const call of calls) {
        expect(call.query).not.toContain(USER_ID);
        expect(call.query).not.toContain(COMPANY_ID);
        expect(call.query).not.toContain(EMAIL);
        expect(call.query).not.toContain("`");
        if (idParam && call.query.includes(`$${idParam}`)) {
          expect(call.params[idParam]).toBe(idParam === "userId" ? USER_ID : COMPANY_ID);
        }
      }
      if (idParam) expect(calls.some((call) => call.query.includes(`$${idParam}`))).toBe(true);
    });
  });

  it("deleteDisconnectedKnowledge only removes AtomicFacts no chunk links and KeyConcepts with no relationship", async () => {
    await repository.deleteDisconnectedKnowledge({ batchSize: 1000 });

    const queries = [...new Set(calls.map((call) => call.query))];
    expect(queries[0]).toContain("MATCH (n:AtomicFact) WHERE NOT (n)<-[:HAS_ATOMIC_FACT]-()");
    expect(queries[1]).toContain("MATCH (n:KeyConcept) WHERE NOT (n)--()");
  });

  it("wipe deletes EmailBlastDelivery by email or user id", async () => {
    await repository.deleteEmailKeyed({ email: EMAIL, userId: USER_ID, batchSize: 1000 });

    const delivery = calls.find((call) => call.query.includes("EmailBlastDelivery"));
    expect(delivery).toBeDefined();
    expect(delivery!.query).toContain(
      "MATCH (n:EmailBlastDelivery) WHERE ($email <> '' AND toLower(n.email) = toLower($email)) OR n.userId = $userId",
    );
    expect(delivery!.query).toContain("DETACH DELETE n");
    expect(delivery!.params).toMatchObject({ email: EMAIL, userId: USER_ID });
  });

  it("deleteCompanyNodes never sweeps User nodes", async () => {
    await repository.deleteCompanyNodes({ companyId: COMPANY_ID, batchSize: 1000 });

    for (const call of calls) expect(call.query).toContain("NOT ");
    expect(calls.some((call) => call.query.includes("WHERE NOT n:User"))).toBe(true);
  });

  it("deleteCompanyShell deletes the company and its memberships by parameter in one transaction", async () => {
    await repository.deleteCompanyShell({ companyId: COMPANY_ID });

    expect(neo4j.executeInTransaction).toHaveBeenCalledTimes(1);
    expect(calls[0].query).toContain("MATCH (company:Company {id: $companyId})");
    expect(calls[0].query).toContain("Membership");
    expect(calls[0].params).toEqual({ companyId: COMPANY_ID });
  });

  it("deleteCompanyShell deletes the company's referrals in the same transaction", async () => {
    await repository.deleteCompanyShell({ companyId: COMPANY_ID });

    expect(neo4j.executeInTransaction).toHaveBeenCalledTimes(1);
    const query = calls[0].query as string;
    const referralMatch = query.indexOf("OPTIONAL MATCH (company)<-[:REFERRED_BY|REFERS_TO]-(referral:Referral)");
    const referralDelete = query.indexOf("DETACH DELETE referral");
    const companyDelete = query.indexOf("DETACH DELETE company");
    expect(referralMatch).toBeGreaterThan(-1);
    expect(referralDelete).toBeGreaterThan(referralMatch);
    expect(companyDelete).toBeGreaterThan(referralDelete);
  });

  it("deleteUserNode deletes one user by parameter", async () => {
    await repository.deleteUserNode({ userId: USER_ID });

    expect(neo4j.executeInTransaction).toHaveBeenCalledTimes(1);
    expect(calls[0].query).toContain("MATCH (u:User {id: $userId})");
    expect(calls[0].query).toContain("DETACH DELETE u");
    expect(calls[0].params).toEqual({ userId: USER_ID });
  });

  it("findCompanyUserIds returns the ids as strings", async () => {
    neo4j.read.mockResolvedValue({ records: [{ get: () => "gm1" }, { get: () => "p1" }] });

    await expect(repository.findCompanyUserIds({ companyId: COMPANY_ID })).resolves.toEqual(["gm1", "p1"]);
    const [query, params] = neo4j.read.mock.calls[0];
    expect(query).toContain("$companyId");
    expect(query).not.toContain(COMPANY_ID);
    expect(params).toEqual({ companyId: COMPANY_ID });
  });
});
