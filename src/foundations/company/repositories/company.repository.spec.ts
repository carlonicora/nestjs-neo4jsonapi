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
import { Company } from "../entities/company";

describe("CompanyRepository", () => {
  let repository: CompanyRepository;
  let mockNeo4jService: vi.Mocked<Neo4jService>;
  let mockClsService: vi.Mocked<ClsService>;

  const MOCK_COMPANY_ID = "company-123";
  const MOCK_COMPANY: Company = {
    id: MOCK_COMPANY_ID,
    type: "companies",
    name: "Test Company",
    logo: "logos/test.png",
    logoUrl: "https://s3.amazonaws.com/logos/test.png",
    isActiveSubscription: true,
    ownerEmail: "owner@test.com",
    monthlyTokens: 10000,
    availableMonthlyTokens: 5000,
    availableExtraTokens: 2000,
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: ClsService, useValue: mockClsService },
      ],
    }).compile();

    repository = module.get<CompanyRepository>(CompanyRepository);
  });

  describe("onModuleInit", () => {
    it("should create unique constraint for company id", async () => {
      mockNeo4jService.writeOne.mockResolvedValue(null);

      await repository.onModuleInit();

      expect(mockNeo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("CREATE CONSTRAINT company_id IF NOT EXISTS"),
      });
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

  describe("create", () => {
    it("should create company with all parameters", async () => {
      mockNeo4jService.validateExistingNodes.mockResolvedValue();
      mockNeo4jService.writeOne.mockResolvedValue(MOCK_COMPANY);

      const result = await repository.create({
        companyId: MOCK_COMPANY_ID,
        name: "New Company",
        configurations: '{"key": "value"}',
        monthlyTokens: 5000,
        availableMonthlyTokens: 5000,
        availableExtraTokens: 1000,
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

      const result = await repository.create({
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

      await repository.create({
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
        monthlyTokens: 20000,
        availableMonthlyTokens: 15000,
        availableExtraTokens: 3000,
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

  describe("useTokens", () => {
    it("should use monthly tokens when sufficient", async () => {
      const companyWithTokens = {
        ...MOCK_COMPANY,
        availableMonthlyTokens: 5000,
        availableExtraTokens: 0,
      };
      mockNeo4jService.readOne.mockResolvedValue(companyWithTokens);
      mockNeo4jService.writeOne.mockResolvedValue();
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      await repository.useTokens({ input: 100, output: 50 });

      expect(mockNeo4jService.readOne).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should use both monthly and extra tokens when monthly insufficient", async () => {
      const companyWithLowMonthly = {
        ...MOCK_COMPANY,
        availableMonthlyTokens: 100,
        availableExtraTokens: 500,
      };
      mockNeo4jService.readOne.mockResolvedValue(companyWithLowMonthly);
      mockNeo4jService.writeOne.mockResolvedValue();
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      await repository.useTokens({ input: 100, output: 50 }); // 150 tokens needed

      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should use explicit companyId when provided", async () => {
      mockNeo4jService.readOne.mockResolvedValue(MOCK_COMPANY);
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.useTokens({
        input: 50,
        output: 25,
        companyId: "explicit-company-id",
      });

      expect(mockNeo4jService.readOne).toHaveBeenCalled();
    });

    it("should handle BigInt token values from Neo4j", async () => {
      const companyWithBigInt = {
        ...MOCK_COMPANY,
        availableMonthlyTokens: BigInt(5000),
        availableExtraTokens: BigInt(2000),
      };
      mockNeo4jService.readOne.mockResolvedValue(companyWithBigInt);
      mockNeo4jService.writeOne.mockResolvedValue();
      mockClsService.get.mockReturnValue(MOCK_COMPANY_ID);

      await repository.useTokens({ input: 100, output: 50 });

      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
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
    it("should update all token fields", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.updateTokens({
        companyId: MOCK_COMPANY_ID,
        monthlyTokens: 10000,
        availableMonthlyTokens: 10000,
        availableExtraTokens: 5000,
      });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
    });

    it("should update only specified token fields", async () => {
      mockNeo4jService.writeOne.mockResolvedValue();

      await repository.updateTokens({
        companyId: MOCK_COMPANY_ID,
        monthlyTokens: 15000,
      });

      expect(mockNeo4jService.writeOne).toHaveBeenCalled();
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

      await repository.delete({ companyId: MOCK_COMPANY_ID });

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
