import { ClsService } from "nestjs-cls";
import type { MockedObject } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { StripeCouponCodeDescriptor } from "../../entities/stripe-coupon-code";
import { StripeCouponCodeRepository } from "../stripe-coupon-code.repository";

type IssuedQuery = { query: string; queryParams: Record<string, unknown> };

describe("StripeCouponCodeRepository", () => {
  // Simulates the prefix Neo4jService.initQuery() emits on an authenticated
  // request: custom Cypher must be appended to it (`+=`), never assigned over it.
  const initQueryPrefix = "MATCH (currentUser:User {id: $currentUserId})\n";

  let neo4j: MockedObject<Neo4jService>;
  let repository: StripeCouponCodeRepository;

  const lastCall = (calls: unknown[][]): IssuedQuery => calls[calls.length - 1][0] as IssuedQuery;

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
      executeInTransaction: vi.fn(async () => []),
      bindsRequestContext: true,
    } as unknown as MockedObject<Neo4jService>;
    const securityService = {} as unknown as MockedObject<SecurityService>;
    const cls = { get: vi.fn(() => undefined), has: vi.fn(() => false) } as unknown as MockedObject<ClsService>;

    repository = new StripeCouponCodeRepository(neo4j, securityService, cls);
  });

  describe("setAutomatic", () => {
    it("setAutomatic clears every other code", async () => {
      await repository.setAutomatic({ id: "c2", automatic: true });

      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
      expect(neo4j.executeInTransaction).not.toHaveBeenCalled();
      const issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
      expect(issued.query).toContain("MATCH (stripeCouponCode:StripeCouponCode {id: $searchValue})");
      expect(issued.query).toContain("stripeCouponCode_other:StripeCouponCode");
      expect(issued.query).toContain("stripeCouponCode_other.id <> $searchValue");
      expect(issued.query).toContain("SET stripeCouponCode_other.automatic = false");
      expect(issued.query).toContain("SET stripeCouponCode.automatic = true");
      expect(issued.query).toContain("updatedAt = datetime()");
      expect(issued.query.indexOf("automatic = false")).toBeLessThan(issued.query.indexOf("automatic = true,"));
      expect(issued.queryParams).toMatchObject({ searchValue: "c2" });
    });

    it("only clears the target when switched off", async () => {
      await repository.setAutomatic({ id: "c2", automatic: false });

      expect(neo4j.writeOne).toHaveBeenCalledTimes(1);
      const issued = lastCall(neo4j.writeOne.mock.calls);
      expect(issued.query).toContain("SET stripeCouponCode.automatic = false");
      expect(issued.query).not.toContain("<> $searchValue");
      expect(issued.query).not.toContain("automatic = true");
      expect(issued.queryParams).toMatchObject({ searchValue: "c2" });
    });
  });

  describe("findAutomatic", () => {
    it("reads one active automatic code with its coupon", async () => {
      await repository.findAutomatic();

      const issued = lastCall(neo4j.readOne.mock.calls);
      expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
      expect(issued.query).toContain("stripeCouponCode.automatic = true AND stripeCouponCode.active = true");
      expect(issued.query).toContain("LIMIT 1");
      expect(issued.query).toContain("<-[:HAS_CODE]-(stripeCouponCode_coupon:StripeCoupon)");
      expect(neo4j.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({ serialiser: StripeCouponCodeDescriptor.model }),
      );
    });
  });

  describe("findByStripePromotionCodeId", () => {
    it("matches on the Stripe promotion code id", async () => {
      await repository.findByStripePromotionCodeId({ stripePromotionCodeId: "promo_1" });

      const issued = lastCall(neo4j.readOne.mock.calls);
      expect(issued.query).toContain("{stripePromotionCodeId: $searchValue}");
      expect(issued.queryParams).toMatchObject({ searchValue: "promo_1" });
    });
  });
});
