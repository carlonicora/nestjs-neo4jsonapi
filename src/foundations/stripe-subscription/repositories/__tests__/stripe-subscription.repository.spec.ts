import type { MockedObject } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { ClsService } from "nestjs-cls";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { StripeSubscriptionDescriptor } from "../../entities/stripe-subscription";
import { StripeSubscriptionRepository } from "../stripe-subscription.repository";

type IssuedQuery = { query: string; queryParams: Record<string, unknown> };

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("StripeSubscriptionRepository", () => {
  // The prefix Neo4jService.initQuery() emits: custom Cypher must be appended (`+=`), never assigned.
  const initQueryPrefix = "PREAMBLE\n";
  const DEFAULT_MATCH = "MATCH (stripeSubscription:StripeSubscription";

  let neo4j: MockedObject<Neo4jService>;
  let cls: MockedObject<ClsService>;
  let repository: StripeSubscriptionRepository;
  let initParams: Record<string, unknown>;

  const lastCall = (calls: unknown[][]): IssuedQuery => calls[calls.length - 1][0] as IssuedQuery;

  beforeEach(() => {
    initParams = { companyId: null, currentUserId: null };
    neo4j = {
      initQuery: vi.fn((params?: any) => ({
        query: initQueryPrefix,
        queryParams: { ...initParams },
        cursor: params?.cursor,
        serialiser: params?.serialiser,
        fetchAll: params?.fetchAll,
      })),
      readOne: vi.fn(async () => null),
      readMany: vi.fn(async () => []),
      writeOne: vi.fn(async () => null),
      writeAndReturnMany: vi.fn(async () => []),
      validateRelatedNodes: vi.fn(async () => undefined),
      bindsRequestContext: true,
    } as unknown as MockedObject<Neo4jService>;
    cls = { get: vi.fn(() => undefined), has: vi.fn(() => false) } as unknown as MockedObject<ClsService>;

    repository = new StripeSubscriptionRepository(neo4j, {} as unknown as SecurityService, cls);
  });

  const expectScopedRead = (issued: IssuedQuery) => {
    expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
    expect(issued.query).toContain(DEFAULT_MATCH);
    expect(issued.query).toContain("stripeSubscription_stripePrice_stripeProduct");
    expect(neo4j.initQuery).toHaveBeenCalledWith(
      expect.objectContaining({ serialiser: StripeSubscriptionDescriptor.model }),
    );
  };

  describe("onModuleInit", () => {
    it("creates the id and stripeSubscriptionId constraints", async () => {
      await repository.onModuleInit();

      const queries = neo4j.writeOne.mock.calls.map((call) => (call[0] as IssuedQuery).query);
      expect(queries.some((q) => q.includes("stripeSubscription_id IF NOT EXISTS"))).toBe(true);
      expect(queries.some((q) => q.includes("stripeSubscription_stripeSubscriptionId IF NOT EXISTS"))).toBe(true);
      expect(queries.some((q) => q.includes("FULLTEXT"))).toBe(false);
    });
  });

  describe("buildReturnStatement", () => {
    it("return statement carries the price product", async () => {
      await repository.findAll();

      const issued = lastCall(neo4j.readMany.mock.calls);
      expect(flat(issued.query)).toContain(
        "MATCH (stripeSubscription)-[:USES_PRICE]->(stripeSubscription_stripePrice:StripePrice)-[:BELONGS_TO]->(stripeSubscription_stripePrice_stripeProduct:StripeProduct)",
      );
      expect(flat(issued.query)).toContain(
        "MATCH (stripeSubscription)-[:BELONGS_TO]->(stripeSubscription_stripeCustomer:StripeCustomer)",
      );
      expect(issued.query).toMatch(/RETURN stripeSubscription,[\s\S]*stripeSubscription_stripePrice_stripeProduct/);
    });
  });

  describe("findByStripeCustomerId", () => {
    it("filters on the internal customer id and the optional status", async () => {
      await repository.findByStripeCustomerId({ stripeCustomerId: "c1", status: "active" });

      const issued = lastCall(neo4j.readMany.mock.calls);
      expectScopedRead(issued);
      expect(issued.query).toContain("-[:BELONGS_TO]->(:StripeCustomer {id: $stripeCustomerId})");
      expect(issued.query).toContain("stripeSubscription.status = $status");
      expect(issued.query).toContain("ORDER BY stripeSubscription.createdAt DESC");
      expect(issued.queryParams).toMatchObject({ stripeCustomerId: "c1", status: "active" });
    });

    it("leaves out the status filter when none is given", async () => {
      await repository.findByStripeCustomerId({ stripeCustomerId: "c1" });

      expect(lastCall(neo4j.readMany.mock.calls).query).not.toContain("$status");
    });
  });

  describe("findById", () => {
    it("is inherited and starts from the default match", async () => {
      neo4j.readOne.mockResolvedValueOnce({ id: "s1" } as never);
      (repository as any).securityService = { userHasAccess: () => "WITH stripeSubscription" };

      await repository.findById({ id: "s1" });

      const issued = lastCall(neo4j.readOne.mock.calls);
      expectScopedRead(issued);
      expect(issued.query).toContain("{id: $searchValue}");
      expect(issued.queryParams).toMatchObject({ searchValue: "s1" });
    });
  });

  describe("findAll", () => {
    it("reads every subscription, oldest first, unpaginated", async () => {
      await repository.findAll();

      const issued = lastCall(neo4j.readMany.mock.calls);
      expectScopedRead(issued);
      expect(neo4j.initQuery).toHaveBeenCalledWith(expect.objectContaining({ fetchAll: true }));
      expect(issued.query).toContain("ORDER BY stripeSubscription.createdAt ASC");
      expect(issued.query).not.toMatch(/SKIP|LIMIT|\{CURSOR\}/);
    });
  });

  describe("findByStripeSubscriptionId", () => {
    it("matches on the Stripe subscription id", async () => {
      await repository.findByStripeSubscriptionId({ stripeSubscriptionId: "sub_1" });

      const issued = lastCall(neo4j.readOne.mock.calls);
      expectScopedRead(issued);
      expect(issued.query).toContain("{stripeSubscriptionId: $searchValue}");
      expect(issued.queryParams).toMatchObject({ searchValue: "sub_1" });
    });
  });

  describe("findActiveByStripeCustomerId", () => {
    it("filters on the Stripe customer id and active or trialing status", async () => {
      await repository.findActiveByStripeCustomerId({ stripeCustomerId: "cus_1" });

      const issued = lastCall(neo4j.readMany.mock.calls);
      expectScopedRead(issued);
      expect(issued.query).toContain("{stripeCustomerId: $stripeCustomerId}");
      expect(issued.query).toContain("stripeSubscription.status IN ['active', 'trialing']");
      expect(issued.queryParams).toMatchObject({ stripeCustomerId: "cus_1" });
    });
  });

  describe("createSubscription", () => {
    const params = {
      stripeCustomerId: "cust-1",
      priceId: "price-1",
      stripeSubscriptionId: "sub_1",
      status: "active" as const,
      currentPeriodStart: new Date("2026-10-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      quantity: 1,
    };

    it("createSubscription keeps the company and creator edges", async () => {
      initParams = { companyId: "company-1", currentUserId: "user-1" };

      await repository.createSubscription(params);

      const issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
      expect(issued.query).toContain("CREATE (stripeSubscription)-[:BELONGS_TO]->(company)");
      expect(issued.query).toContain("CREATE (stripeSubscription)-[:CREATED_BY]->(currentUser)");
      expect(issued.query).toContain("-[:BELONGS_TO]->(newStripeCustomer)");
      expect(issued.query).toContain("-[:USES_PRICE]->(newStripePrice)");
      expect(issued.query).toContain("currentPeriodStart: datetime($currentPeriodStart)");
      expect(issued.query).toContain("stripeSubscription_stripePrice_stripeProduct");
      expect(issued.queryParams).toMatchObject({
        stripeCustomerId: "cust-1",
        priceId: "price-1",
        currentPeriodStart: "2026-10-01T00:00:00.000Z",
        companyId: "company-1",
      });
      expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({
        nodes: [
          { id: "cust-1", label: "StripeCustomer" },
          { id: "price-1", label: "StripePrice" },
        ],
      });
    });

    it("leaves out the company and creator edges when CLS has neither", async () => {
      await repository.createSubscription(params);

      const issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query).not.toContain("->(company)");
      expect(issued.query).not.toContain("->(currentUser)");
    });

    it("createSubscription refuses an unknown price", async () => {
      neo4j.validateRelatedNodes.mockRejectedValueOnce(new Error("Related node not found"));

      await expect(repository.createSubscription(params)).rejects.toThrow("Related node not found");
      expect(neo4j.writeOne).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("update clears a clearable datetime field with null", async () => {
      await repository.update({ id: "s1", cardExpiryCheckedFor: null });

      let issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
      expect(issued.query).toContain(`${DEFAULT_MATCH} {id: $searchValue}`);
      expect(issued.query).toContain("stripeSubscription.cardExpiryCheckedFor = null");
      expect(issued.queryParams).toMatchObject({ searchValue: "s1" });
      expect(issued.queryParams).not.toHaveProperty("cardExpiryCheckedFor");

      const d = new Date("2027-01-01T00:00:00.000Z");
      await repository.update({ id: "s1", cardExpiryCheckedFor: d });

      issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query).toContain("stripeSubscription.cardExpiryCheckedFor = datetime($cardExpiryCheckedFor)");
      expect(issued.queryParams).toMatchObject({ cardExpiryCheckedFor: d.toISOString() });
    });

    it("leaves an undefined field untouched", async () => {
      await repository.update({ id: "s1", status: "past_due" });

      const issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query).toContain("stripeSubscription.status = $status");
      expect(issued.query).not.toContain("cardExpiryCheckedFor");
      expect(issued.query).not.toContain("discountPercentOff");
    });

    it("writes every clearable datetime field with a datetime cast", async () => {
      const at = new Date("2026-11-01T00:00:00.000Z");
      await repository.update({
        id: "s1",
        canceledAt: at,
        cardExpiryCheckedFor: at,
      });

      const issued = lastCall(neo4j.writeOne.mock.calls);
      for (const field of ["canceledAt", "cardExpiryCheckedFor"]) {
        expect(issued.query).toContain(`stripeSubscription.${field} = datetime($${field})`);
        expect(issued.queryParams[field]).toBe(at.toISOString());
      }
      expect(issued.query).toMatch(/SET [\s\S]*WITH stripeSubscription[\s\S]*RETURN/);
    });

    it("clears the discount with null", async () => {
      await repository.update({ id: "s1", discount: null });

      const issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query).toContain("stripeSubscription.discountPercentOff = $discountPercentOff");
      expect(issued.queryParams).toMatchObject({ discountPercentOff: null, discountEnd: null });
    });
  });

  describe("updateByStripeSubscriptionId", () => {
    it("updates the subscription found by Stripe id", async () => {
      neo4j.readOne.mockResolvedValueOnce({ id: "s1" } as never);

      await repository.updateByStripeSubscriptionId({ stripeSubscriptionId: "sub_1", status: "canceled" });

      const issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query).toContain(`${DEFAULT_MATCH} {id: $searchValue}`);
      expect(issued.queryParams).toMatchObject({ searchValue: "s1", status: "canceled" });
    });

    it("returns null when no subscription has the Stripe id", async () => {
      await expect(repository.updateByStripeSubscriptionId({ stripeSubscriptionId: "sub_x" })).resolves.toBeNull();
      expect(neo4j.writeOne).not.toHaveBeenCalled();
    });
  });

  describe("updatePrice", () => {
    it("swaps the price edge after checking the new price", async () => {
      await repository.updatePrice({ id: "s1", newPriceId: "price-2" });

      const issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query).toContain(`${DEFAULT_MATCH} {id: $searchValue}`);
      expect(issued.query).toContain("DELETE oldRel");
      expect(issued.query).toContain("MATCH (newStripePrice:StripePrice {id: $newPriceId})");
      expect(issued.query).toContain("CREATE (stripeSubscription)-[:USES_PRICE]->(newStripePrice)");
      expect(issued.queryParams).toMatchObject({ searchValue: "s1", newPriceId: "price-2" });
      expect(neo4j.validateRelatedNodes).toHaveBeenCalledWith({ nodes: [{ id: "price-2", label: "StripePrice" }] });
    });

    it("refuses an unknown price", async () => {
      neo4j.validateRelatedNodes.mockRejectedValueOnce(new Error("Related node not found"));

      await expect(repository.updatePrice({ id: "s1", newPriceId: "price-x" })).rejects.toThrow();
      expect(neo4j.writeOne).not.toHaveBeenCalled();
    });
  });

  describe("cancelAllByStripeCustomerId", () => {
    it("returns how many subscriptions it cancelled", async () => {
      neo4j.writeAndReturnMany.mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }] as never);

      await expect(repository.cancelAllByStripeCustomerId({ stripeCustomerId: "cus_1" })).resolves.toBe(2);
    });

    it("cancels the customer's live subscriptions from the default match", async () => {
      await repository.cancelAllByStripeCustomerId({ stripeCustomerId: "cus_1" });

      const issued = lastCall(neo4j.writeAndReturnMany.mock.calls);
      expect(neo4j.initQuery).toHaveBeenLastCalledWith({ serialiser: StripeSubscriptionDescriptor.model });
      expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
      expect(issued.query).toContain(DEFAULT_MATCH);
      expect(issued.query).toContain("{stripeCustomerId: $stripeCustomerId}");
      expect(issued.query).toContain("stripeSubscription.status IN ['active', 'trialing', 'past_due']");
      expect(issued.query).toContain("stripeSubscription.canceledAt = datetime($canceledAt)");
      expect(issued.queryParams).toMatchObject({ stripeCustomerId: "cus_1", canceledStatus: "canceled" });
    });
  });

  describe("cron finders", () => {
    const now = new Date("2026-11-01T10:00:00.000Z");
    const before = new Date("2026-11-08T10:00:00.000Z");

    it("findRenewalsForCardCheck skips cancelling subscriptions", async () => {
      await repository.findRenewalsForCardCheck({ now, before });

      const issued = lastCall(neo4j.readMany.mock.calls);
      expectScopedRead(issued);
      expect(issued.query).toContain('stripeSubscription.status = "active"');
      expect(issued.query).toContain("stripeSubscription.cancelAtPeriodEnd = false");
      expect(issued.query).toContain("stripeSubscription.currentPeriodEnd > datetime($now)");
      expect(issued.query).toContain("stripeSubscription.currentPeriodEnd <= datetime($before)");
      expect(issued.query).toContain(
        "stripeSubscription.cardExpiryCheckedFor IS NULL OR stripeSubscription.cardExpiryCheckedFor <> stripeSubscription.currentPeriodEnd",
      );
      expect(issued.query).toContain('recurringPrice.priceType = "recurring"');
      expect(issued.queryParams).toMatchObject({ now: now.toISOString(), before: before.toISOString() });
    });

    it("cron finders refuse to run inside a request", async () => {
      cls.get.mockImplementation(((key: string) => (key === "companyId" ? "company-1" : undefined)) as never);

      await expect(repository.findRenewalsForCardCheck({ now, before })).rejects.toThrow(/worker cron only/);
      expect(neo4j.readMany).not.toHaveBeenCalled();
    });

    const after = new Date("2026-10-29T08:00:00.000Z");
    const upTo = new Date("2026-10-31T08:00:00.000Z");

    it("findOpenTrialsEndingBetween refuses to run with a company in CLS", async () => {
      cls.get.mockImplementation(((key: string) => (key === "companyId" ? "company-1" : undefined)) as never);

      await expect(repository.findOpenTrialsEndingBetween({ after, upTo })).rejects.toThrow(/worker cron only/);
      expect(neo4j.readMany).not.toHaveBeenCalled();
    });

    it("findOpenTrialsEndingBetween passes the window as ISO strings", async () => {
      await repository.findOpenTrialsEndingBetween({ after, upTo });

      const issued = lastCall(neo4j.readMany.mock.calls);
      expect(issued.queryParams.after).toBe(after.toISOString());
      expect(issued.queryParams.upTo).toBe(upTo.toISOString());
    });

    it("findOpenTrialsEndingBetween filters trialing subscriptions in the window and excludes paying customers", async () => {
      await repository.findOpenTrialsEndingBetween({ after, upTo });

      expect(neo4j.readMany).toHaveBeenCalledTimes(1);
      const issued = lastCall(neo4j.readMany.mock.calls);
      expectScopedRead(issued);
      expect(issued.query).toContain('stripeSubscription.status = "trialing"');
      expect(issued.query).toContain("stripeSubscription.trialEnd > datetime($after)");
      expect(issued.query).toContain("stripeSubscription.trialEnd <= datetime($upTo)");
      expect(issued.query).toContain("NOT EXISTS");
      expect(issued.query).toContain("['active', 'past_due']");
      expect(issued.query).toContain("isTrial");
      expect(issued.query).toContain("unitAmount");
    });
  });
});
