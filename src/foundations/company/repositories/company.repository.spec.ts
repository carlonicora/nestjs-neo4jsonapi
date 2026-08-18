/**
 * Company Repository Unit Tests
 *
 * Tests the CompanyRepository class that handles Neo4j database operations for Company.
 * These tests verify that the repository works correctly before and after migration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { CompanyRepository } from "./company.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Company } from "../entities/company";

describe("CompanyRepository", () => {
  let repository: CompanyRepository;
  let mockNeo4jService: vi.Mocked<Neo4jService>;
  let mockClsService: vi.Mocked<ClsService>;
  let mockSecurityService: vi.Mocked<SecurityService>;

  const MOCK_COMPANY_ID = "company-123";
  const MOCK_COMPANY: Company = {
    id: MOCK_COMPANY_ID,
    type: "companies",
    name: "Test Company",
    logo: "logos/test.png",
    logoUrl: "https://s3.amazonaws.com/logos/test.png",
    isActiveSubscription: true,
    ownerEmail: "owner@test.com",
    monthlyCredits: 10000,
    availableMonthlyCredits: 5000,
    availableExtraCredits: 2000,
    configurations: '{"setting": true}',
    feature: [],
    module: [],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-06-15"),
  };

  beforeEach(async () => {
    mockNeo4jService = {
      initQuery: vi.fn().mockReturnValue({
        query: "",
        queryParams: {},
      }),
      readOne: vi.fn(),
      readMany: vi.fn(),
      writeOne: vi.fn(),
      read: vi.fn(),
      validateExistingNodes: vi.fn(),
    } as any;

    mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    } as any;

    mockSecurityService = {
      userHasAccess: vi.fn().mockImplementation(({ validator }: any) => validator()),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: SecurityService, useValue: mockSecurityService },
        { provide: ClsService, useValue: mockClsService },
      ],
    }).compile();

    repository = module.get<CompanyRepository>(CompanyRepository);
  });

  describe("onModuleInit (inherited from AbstractRepository)", () => {
    it("should create unique constraint for company id", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(null);
      // The inherited implementation also reconciles the descriptor's FULLTEXT index.
      mockNeo4jService.read.mockResolvedValue({ records: [] });

      await repository.onModuleInit();

      expect(mockNeo4jService.writeOne).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("CREATE CONSTRAINT company_id IF NOT EXISTS"),
        }),
      );
    });
  });

  describe("fetchAll", () => {
    it("should fetch all companies", async () => {
      const mockCompanies = [MOCK_COMPANY];
      mockNeo4jService.readMany.mockResolvedValue(mockCompanies);

      const result = await repository.fetchAll();

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual(mockCompanies);
    });

    it("should return empty array when no companies exist", async () => {
      mockNeo4jService.readMany.mockResolvedValue([]);

      const result = await repository.fetchAll();

      expect(result).toEqual([]);
    });
  });

  describe("findByCompanyId", () => {
    it("should find company by ID with related features and modules", async () => {
      mockNeo4jService.readOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.findByCompanyId({ companyId: MOCK_COMPANY_ID });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_COMPANY);
    });

    it("should return null when company not found", async () => {
      mockNeo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByCompanyId({ companyId: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("findCurrent", () => {
    it("should find company with provided companyId", async () => {
      mockNeo4jService.readOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.findCurrent(MOCK_COMPANY_ID);

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_COMPANY);
    });

    it("should find company without companyId parameter", async () => {
      mockNeo4jService.readOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.findCurrent();

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_COMPANY);
    });
  });

  describe("findSingle", () => {
    it("should find a single company", async () => {
      mockNeo4jService.readOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.findSingle();

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_COMPANY);
    });

    it("should return null when no company exists", async () => {
      mockNeo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findSingle();

      expect(result).toBeNull();
    });
  });

  describe("createCompanyNode", () => {
    it("should create company with all parameters", async () => {
      mockNeo4jService.validateExistingNodes.mockResolvedValue();
      mockNeo4jService.writeOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.createCompanyNode({
        companyId: MOCK_COMPANY_ID,
        name: "New Company",
        configurations: '{"key": "value"}',
        monthlyCredits: 5000,
        availableMonthlyCredits: 5000,
        availableExtraCredits: 1000,
        featureIds: ["feature-1", "feature-2"],
        moduleIds: ["module-1"],
      });

      expect(mockNeo4jService.validateExistingNodes).toHaveBeenCalled();
      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_COMPANY);
    });

    it("should create company with minimal parameters", async () => {
      mockNeo4jService.validateExistingNodes.mockResolvedValue();
      mockNeo4jService.writeOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.createCompanyNode({
        companyId: MOCK_COMPANY_ID,
        name: "Minimal Company",
      });

      expect(mockNeo4jService.validateExistingNodes).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_COMPANY);
    });

    it("should validate feature and module IDs before creation", async () => {
      mockNeo4jService.validateExistingNodes.mockResolvedValue();
      mockNeo4jService.writeOne.mockResolvedValue(MOCK_COMPANY);

      await repository.createCompanyNode({
        companyId: MOCK_COMPANY_ID,
        name: "Company with relations",
        featureIds: ["feature-1"],
        moduleIds: ["module-1"],
      });

      expect(mockNeo4jService.validateExistingNodes).toHaveBeenCalledWith({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "feature-1", label: "Feature" }),
          expect.objectContaining({ id: "module-1", label: "Module" }),
        ]),
      });
    });
  });

  describe("update", () => {
    it("should update company with all parameters", async () => {
      mockNeo4jService.validateExistingNodes.mockResolvedValue();
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.update({
        companyId: MOCK_COMPANY_ID,
        name: "Updated Company",
        configurations: '{"updated": true}',
        logo: "logos/new.png",
        monthlyCredits: 20000,
        availableMonthlyCredits: 15000,
        availableExtraCredits: 3000,
        featureIds: ["feature-new"],
        moduleIds: ["module-new"],
      });

      expect(mockNeo4jService.validateExistingNodes).toHaveBeenCalled();
      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should update company with only required parameters", async () => {
      mockNeo4jService.validateExistingNodes.mockResolvedValue();
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.update({
        companyId: MOCK_COMPANY_ID,
        name: "Updated Name Only",
      });

      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("updateConfigurations", () => {
    it("should update only configurations", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.updateConfigurations({
        companyId: MOCK_COMPANY_ID,
        configurations: '{"newConfig": true}',
      });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should handle empty configurations", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.updateConfigurations({
        companyId: MOCK_COMPANY_ID,
        configurations: "",
      });

      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("createByName", () => {
    it("should create company with just name", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.createByName({ name: "Simple Company" });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_COMPANY);
    });
  });

  describe("useCredits", () => {
    /** The deduction waterfall runs inside Neo4j, so the driver echoes the post-write node back. */
    const companyAfterWrite = (availableMonthlyCredits: number, availableExtraCredits: number) => ({
      ...MOCK_COMPANY,
      availableMonthlyCredits,
      availableExtraCredits,
    });

    /**
     * Regression guard for a LOST UPDATE that silently under-billed customers.
     *
     * The query used to project the balances into a `WITH` and subtract from those captured
     * values. `WITH` runs BEFORE `SET` takes the node's write lock, so concurrent deductions
     * all read the same balance and the last writer wins. Measured on a probe node: 200
     * concurrent deductions of 1 credit from 1000 deducted 19 — 90.5% lost. In a real run,
     * 71.44 of 1669.55 credits went uncharged.
     *
     * A unit test cannot exercise concurrency, but it CAN pin the query shape that caused it:
     * every balance read must sit inside the `SET`, where it is evaluated under the lock.
     */
    it("reads every balance inside the SET, never into a WITH before it", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(companyAfterWrite(10, 0));
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      await repository.useCredits({ credits: 1 });

      const { query } = mockNeo4jService.writeOne.mock.calls[0][0];
      const beforeSet = query.slice(0, query.indexOf("SET "));

      expect(beforeSet).not.toMatch(/availableMonthlyCredits/);
      expect(beforeSet).not.toMatch(/availableExtraCredits/);
      expect(beforeSet).not.toMatch(/\bWITH\b/);
      // And the arithmetic must reference the properties, i.e. read them at write time.
      expect(query).toMatch(/SET[\s\S]*company\.availableMonthlyCredits[\s\S]*company\.availableMonthlyCredits/);
    });

    it("returns the new balances when the monthly allowance covers the deduction", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(companyAfterWrite(4990.5, 200));
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      const result = await repository.useCredits({ credits: 9.5 });

      expect(result).toEqual({ availableMonthlyCredits: 4990.5, availableExtraCredits: 200 });
      const writtenQuery = mockNeo4jService.writeOne.mock.calls[0][0];
      expect(writtenQuery.queryParams).toEqual({ companyId: MOCK_COMPANY_ID, credits: 9.5 });
    });

    it("returns the new balances when the deduction spills from monthly into extra", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(companyAfterWrite(0, 450.25));
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      const result = await repository.useCredits({ credits: 149.75 });

      expect(result).toEqual({ availableMonthlyCredits: 0, availableExtraCredits: 450.25 });
    });

    it("returns the new balances when deducting from extra only", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(companyAfterWrite(0, 850));
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      const result = await repository.useCredits({ credits: 150 });

      expect(result).toEqual({ availableMonthlyCredits: 0, availableExtraCredits: 850 });
    });

    it("returns a negative extra balance unchanged — balances are deliberately not clamped", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(companyAfterWrite(0, -12.4));
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      const result = await repository.useCredits({ credits: 20 });

      expect(result).toEqual({ availableMonthlyCredits: 0, availableExtraCredits: -12.4 });
    });

    it("uses the explicit companyId when provided instead of the CLS one", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(companyAfterWrite(10, 0));
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      await repository.useCredits({ credits: 1, companyId: "explicit-company-id" });

      const writtenQuery = mockNeo4jService.writeOne.mock.calls[0][0];
      expect(writtenQuery.queryParams.companyId).toBe("explicit-company-id");
    });

    it("does nothing when zero or negative credits are consumed", async () => {
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      const zero = await repository.useCredits({ credits: 0 });
      const negative = await repository.useCredits({ credits: -5 });

      expect(zero).toBeUndefined();
      expect(negative).toBeUndefined();
      expect(mockNeo4jService.readOne).not.toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).not.toHaveBeenCalled();
    });

    it("returns undefined when the company node does not exist", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(undefined);
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      const result = await repository.useCredits({ credits: 5 });

      expect(result).toBeUndefined();
    });

    it("deducts atomically — a single MATCH ... SET ... RETURN statement, no separate read", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(companyAfterWrite(1, 1));
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      await repository.useCredits({ credits: 5 });

      expect(mockNeo4jService.readOne).not.toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalledTimes(1);

      const { query } = mockNeo4jService.writeOne.mock.calls[0][0];
      expect(query.match(/MATCH /g)).toHaveLength(1);
      expect(query.match(/\bSET\b/g)).toHaveLength(1);
      expect(query.match(/RETURN /g)).toHaveLength(1);
      expect(query).toContain("MATCH (company:Company {id: $companyId})");
      // Whitespace-tolerant: the assignment spans lines now that each balance is re-read
      // inside the SET. Note this test asserted "atomically" while the query was NOT atomic —
      // statement shape alone cannot see a lost update; the WITH-free assertion above can.
      expect(query).toMatch(/company\.availableMonthlyCredits\s*=\s*\n?\s*CASE/);
      expect(query).toContain("company.availableExtraCredits");
      expect(query).toContain("RETURN company");
    });
  });

  describe("markSubscriptionStatus", () => {
    it("should update subscription status", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.markSubscriptionStatus({
        companyId: MOCK_COMPANY_ID,
        isActiveSubscription: true,
      });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should deactivate subscription", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.markSubscriptionStatus({
        companyId: MOCK_COMPANY_ID,
        isActiveSubscription: false,
      });

      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("updateTokens", () => {
    it("should update all credit fields", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.updateTokens({
        companyId: MOCK_COMPANY_ID,
        monthlyCredits: 10000,
        availableMonthlyCredits: 10000,
        availableExtraCredits: 5000,
      });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should update only specified credit fields", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.updateTokens({
        companyId: MOCK_COMPANY_ID,
        monthlyCredits: 15000,
      });

      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("writes aiEnabled when provided", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.updateTokens({ companyId: MOCK_COMPANY_ID, aiEnabled: false });

      const query = mockNeo4jService.writeOne.mock.calls[0][0];
      expect(query.query).toContain("company.aiEnabled = $aiEnabled");
      expect(query.queryParams.aiEnabled).toBe(false);
    });

    it("omits aiEnabled from the SET clause when not provided", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.updateTokens({ companyId: MOCK_COMPANY_ID, monthlyCredits: 100 });

      const query = mockNeo4jService.writeOne.mock.calls[0][0];
      expect(query.query).not.toContain("company.aiEnabled");
    });
  });

  describe("find", () => {
    it("should find companies with search term", async () => {
      const mockCompanies = [MOCK_COMPANY];
      mockNeo4jService.readMany.mockResolvedValue(mockCompanies);

      const result = await repository.find({
        term: "test",
        cursor: { skip: 0, limit: 10 } as any,
      });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual(mockCompanies);
    });

    it("should find companies without search term", async () => {
      const mockCompanies = [MOCK_COMPANY];
      mockNeo4jService.readMany.mockResolvedValue(mockCompanies);

      const result = await repository.find({
        term: "",
        cursor: { skip: 0, limit: 10 } as any,
      });

      expect(mockNeo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual(mockCompanies);
    });
  });

  describe("delete", () => {
    it("should delete company by ID", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.delete({ id: MOCK_COMPANY_ID });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("findByStripeCustomerId", () => {
    it("should find company by Stripe customer ID", async () => {
      mockNeo4jService.readOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: "stripe-cust-123",
      });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readOne).toHaveBeenCalled();
      expect(result).toEqual(MOCK_COMPANY);
    });

    it("should return null when no company found for Stripe customer", async () => {
      mockNeo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByStripeCustomerId({
        stripeCustomerId: "nonexistent-stripe-id",
      });

      expect(result).toBeNull();
    });
  });

  describe("countCompanyUsers", () => {
    it("should count users in company", async () => {
      mockNeo4jService.read.mockResolvedValue({ userCount: 10 });

      const result = await repository.countCompanyUsers({ companyId: MOCK_COMPANY_ID });

      expect(mockNeo4jService.read).toHaveBeenCalled();
      expect(result).toBe(10);
    });

    it("should return 0 when no users found", async () => {
      mockNeo4jService.read.mockResolvedValue({ userCount: 0 });

      const result = await repository.countCompanyUsers({ companyId: MOCK_COMPANY_ID });

      expect(result).toBe(0);
    });

    it("should return 0 when result is null", async () => {
      mockNeo4jService.read.mockResolvedValue(null);

      const result = await repository.countCompanyUsers({ companyId: MOCK_COMPANY_ID });

      expect(result).toBe(0);
    });
  });

  describe("scheduleCompanyDeletion", () => {
    it("should set deletion schedule with 30-day offset", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      const endDate = new Date("2025-01-15");
      await repository.scheduleCompanyDeletion({
        companyId: MOCK_COMPANY_ID,
        endDate,
        reason: "trial_expired",
      });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should set subscriptionEndedAt, scheduledDeletionAt, and deactivationReason", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.writeOne.mockImplementation(async (query: any) => {
        capturedQuery = query;
      });

      const endDate = new Date("2025-01-15");
      await repository.scheduleCompanyDeletion({
        companyId: MOCK_COMPANY_ID,
        endDate,
        reason: "subscription_cancelled",
      });

      expect(capturedQuery.queryParams.companyId).toBe(MOCK_COMPANY_ID);
      expect(capturedQuery.queryParams.subscriptionEndedAt).toBe(endDate.toISOString());
      expect(capturedQuery.queryParams.deactivationReason).toBe("subscription_cancelled");
      expect(capturedQuery.query).toContain("company.subscriptionEndedAt");
      expect(capturedQuery.query).toContain("company.scheduledDeletionAt");
      expect(capturedQuery.query).toContain("company.deactivationReason");
    });

    it("should calculate scheduledDeletionAt as endDate + 30 days", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.writeOne.mockImplementation(async (query: any) => {
        capturedQuery = query;
      });

      const endDate = new Date("2025-01-15T00:00:00.000Z");
      await repository.scheduleCompanyDeletion({
        companyId: MOCK_COMPANY_ID,
        endDate,
        reason: "trial_expired",
      });

      const expectedDeletionDate = new Date("2025-02-14T00:00:00.000Z");
      expect(capturedQuery.queryParams.scheduledDeletionAt).toBe(expectedDeletionDate.toISOString());
    });
  });

  describe("clearDeletionSchedule", () => {
    it("should clear all deletion fields to null", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.clearDeletionSchedule({ companyId: MOCK_COMPANY_ID });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should set subscriptionEndedAt, scheduledDeletionAt, and deactivationReason to null", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.writeOne.mockImplementation(async (query: any) => {
        capturedQuery = query;
      });

      await repository.clearDeletionSchedule({ companyId: MOCK_COMPANY_ID });

      expect(capturedQuery.queryParams.companyId).toBe(MOCK_COMPANY_ID);
      expect(capturedQuery.query).toContain("company.subscriptionEndedAt = null");
      expect(capturedQuery.query).toContain("company.scheduledDeletionAt = null");
      expect(capturedQuery.query).toContain("company.deactivationReason = null");
    });
  });

  describe("findCompaniesForDeletion", () => {
    it("should return companies past scheduledDeletionAt with inactive subscription", async () => {
      const companiesForDeletion = [
        { ...MOCK_COMPANY, scheduledDeletionAt: new Date("2025-01-01"), isActiveSubscription: false },
      ];
      mockNeo4jService.readMany.mockResolvedValue(companiesForDeletion);

      const result = await repository.findCompaniesForDeletion();

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual(companiesForDeletion);
    });

    it("should return empty array when no companies match deletion criteria", async () => {
      mockNeo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findCompaniesForDeletion();

      expect(result).toEqual([]);
    });

    it("should query for companies with scheduledDeletionAt <= now and isActiveSubscription = false", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.readMany.mockImplementation(async (query: any) => {
        capturedQuery = query;
        return [];
      });

      await repository.findCompaniesForDeletion();

      expect(capturedQuery.query).toContain("scheduledDeletionAt IS NOT NULL");
      expect(capturedQuery.query).toContain("scheduledDeletionAt <= datetime()");
      expect(capturedQuery.query).toContain("isActiveSubscription = false");
    });
  });

  describe("findCompaniesForDeletionWarning", () => {
    it("should return companies N days before deletion", async () => {
      const companiesForWarning = [
        { ...MOCK_COMPANY, scheduledDeletionAt: new Date("2025-01-22"), isActiveSubscription: false },
      ];
      mockNeo4jService.readMany.mockResolvedValue(companiesForWarning);

      const result = await repository.findCompaniesForDeletionWarning({ daysBeforeDeletion: 7 });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual(companiesForWarning);
    });

    it("should use day boundaries (startOfDay, endOfDay) in query", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.readMany.mockImplementation(async (query: any) => {
        capturedQuery = query;
        return [];
      });

      await repository.findCompaniesForDeletionWarning({ daysBeforeDeletion: 7 });

      expect(capturedQuery.queryParams.startOfDay).toBeDefined();
      expect(capturedQuery.queryParams.endOfDay).toBeDefined();
      expect(capturedQuery.query).toContain("scheduledDeletionAt >= datetime($startOfDay)");
      expect(capturedQuery.query).toContain("scheduledDeletionAt <= datetime($endOfDay)");
    });

    it("should query for companies with inactive subscription", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.readMany.mockImplementation(async (query: any) => {
        capturedQuery = query;
        return [];
      });

      await repository.findCompaniesForDeletionWarning({ daysBeforeDeletion: 1 });

      expect(capturedQuery.query).toContain("isActiveSubscription = false");
    });

    it("should return empty array when no companies match warning criteria", async () => {
      mockNeo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findCompaniesForDeletionWarning({ daysBeforeDeletion: 7 });

      expect(result).toEqual([]);
    });
  });
});
