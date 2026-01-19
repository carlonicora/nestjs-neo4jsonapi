import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide the imports that StripeUsageAdminService needs
vi.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = vi.importActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
    // Override companyMeta that billing-customer.model needs
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { StripeUsageAdminService } from "../stripe-usage-admin.service";
import { StripeUsageRecordRepository } from "../../repositories/stripe-usage-record.repository";
import { StripeSubscriptionRepository } from "../../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
import { JsonApiService } from "../../../../core/jsonapi";
import { StripeUsageApiService } from "../stripe-usage-api.service";
import { StripeUsageRecord } from "../../entities/stripe-usage-record.entity";
import { StripeSubscription } from "../../../stripe-subscription/entities/stripe-subscription.entity";
import { StripeCustomer } from "../../../stripe-customer/entities/stripe-customer.entity";
import { TEST_IDS } from "../../../stripe/__tests__/fixtures/stripe.fixtures";

describe("StripeUsageAdminService", () => {
  let service: StripeUsageAdminService;
  let usageRecordRepository: vi.Mocked<StripeUsageRecordRepository>;
  let subscriptionRepository: vi.Mocked<StripeSubscriptionRepository>;
  let stripeCustomerRepository: vi.Mocked<StripeCustomerRepository>;
  let stripeUsageApiService: vi.Mocked<StripeUsageApiService>;
  let jsonApiService: vi.Mocked<JsonApiService>;

  // Test data constants
  const MOCK_STRIPE_CUSTOMER: StripeCustomer = {
    id: "990e8400-e29b-41d4-a716-446655440001",
    stripeCustomerId: TEST_IDS.customerId,
    email: "test@example.com",
    name: "Test Customer",
    currency: "usd",
    balance: 0,
    delinquent: false,
    defaultPaymentMethodId: TEST_IDS.paymentMethodId,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    company: {} as any,
  };

  const MOCK_SUBSCRIPTION: StripeSubscription = {
    id: "aa0e8400-e29b-41d4-a716-446655440001",
    stripeSubscriptionId: TEST_IDS.subscriptionId,
    stripeSubscriptionItemId: "si_test_123",
    status: "active",
    currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2025-02-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    quantity: 1,
    stripeCustomer: MOCK_STRIPE_CUSTOMER,
    price: {} as any,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const MOCK_USAGE_RECORD: StripeUsageRecord = {
    id: "cc0e8400-e29b-41d4-a716-446655440001",
    subscriptionId: MOCK_SUBSCRIPTION.id,
    meterId: TEST_IDS.meterId,
    meterEventName: "api_call",
    quantity: 100,
    timestamp: new Date("2025-01-15T12:00:00Z"),
    stripeEventId: "evt_usage_123",
    createdAt: new Date("2025-01-15T12:00:00Z"),
    updatedAt: new Date("2025-01-15T12:00:00Z"),
  };

  const MOCK_STRIPE_METER_EVENT = {
    identifier: "evt_usage_123",
    created: Math.floor(new Date("2025-01-15T12:00:00Z").getTime() / 1000),
    livemode: false,
  };

  const MOCK_JSON_API_RESPONSE = {
    data: {
      type: "usage-records",
      id: MOCK_USAGE_RECORD.id,
      attributes: {
        subscriptionId: MOCK_USAGE_RECORD.subscriptionId,
        meterId: MOCK_USAGE_RECORD.meterId,
        meterEventName: MOCK_USAGE_RECORD.meterEventName,
        quantity: MOCK_USAGE_RECORD.quantity,
        timestamp: MOCK_USAGE_RECORD.timestamp.toISOString(),
        stripeEventId: MOCK_USAGE_RECORD.stripeEventId,
      },
    },
  };

  const MOCK_JSON_API_LIST_RESPONSE = {
    data: [MOCK_JSON_API_RESPONSE.data],
    meta: {
      page: {
        total: 1,
      },
    },
  };

  beforeEach(async () => {
    const mockUsageRecordRepository = {
      create: vi.fn(),
      findBySubscriptionId: vi.fn(),
      getUsageSummary: vi.fn(),
    };

    const mockStripeSubscriptionRepository = {
      findById: vi.fn(),
    };

    const mockStripeCustomerRepository = {
      findByCompanyId: vi.fn(),
    };

    const mockStripeUsageApiService = {
      reportMeterEvent: vi.fn(),
      getMeterEventSummaries: vi.fn(),
      listMeters: vi.fn(),
    };

    const mockJsonApiService = {
      buildSingle: vi.fn(),
      buildList: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeUsageAdminService,
        {
          provide: StripeUsageRecordRepository,
          useValue: mockUsageRecordRepository,
        },
        {
          provide: StripeSubscriptionRepository,
          useValue: mockStripeSubscriptionRepository,
        },
        {
          provide: StripeCustomerRepository,
          useValue: mockStripeCustomerRepository,
        },
        {
          provide: StripeUsageApiService,
          useValue: mockStripeUsageApiService,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
      ],
    }).compile();

    service = module.get<StripeUsageAdminService>(StripeUsageAdminService);
    usageRecordRepository = module.get(StripeUsageRecordRepository);
    subscriptionRepository = module.get(StripeSubscriptionRepository);
    stripeCustomerRepository = module.get(StripeCustomerRepository);
    stripeUsageApiService = module.get(StripeUsageApiService);
    jsonApiService = module.get(JsonApiService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("reportUsage", () => {
    const validReportParams = {
      companyId: TEST_IDS.companyId,
      subscriptionId: MOCK_SUBSCRIPTION.id,
      meterId: TEST_IDS.meterId,
      meterEventName: "api_call",
      quantity: 100,
    };

    it("should report usage successfully with default timestamp", async () => {
      const beforeTest = new Date();
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.reportMeterEvent.mockResolvedValue(MOCK_STRIPE_METER_EVENT);
      usageRecordRepository.create.mockResolvedValue(MOCK_USAGE_RECORD);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.reportUsage(validReportParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validReportParams.subscriptionId });
      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validReportParams.companyId,
      });

      // Verify timestamp was created and converted correctly (divide by 1000 and floor)
      const stripeCall = stripeUsageApiService.reportMeterEvent.mock.calls[0][0];
      expect(stripeCall.eventName).toBe(validReportParams.meterEventName);
      expect(stripeCall.customerId).toBe(MOCK_STRIPE_CUSTOMER.stripeCustomerId);
      expect(stripeCall.value).toBe(validReportParams.quantity);
      expect(stripeCall.timestamp).toBeGreaterThanOrEqual(Math.floor(beforeTest.getTime() / 1000));
      expect(stripeCall.timestamp).toBeLessThanOrEqual(Math.floor(new Date().getTime() / 1000));

      expect(usageRecordRepository.create).toHaveBeenCalledWith({
        subscriptionId: validReportParams.subscriptionId,
        meterId: validReportParams.meterId,
        meterEventName: validReportParams.meterEventName,
        quantity: validReportParams.quantity,
        timestamp: expect.any(Date),
        stripeEventId: MOCK_STRIPE_METER_EVENT.identifier,
      });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should report usage with custom timestamp", async () => {
      const customTimestamp = new Date("2025-01-20T15:30:00Z");
      const expectedUnixTimestamp = Math.floor(customTimestamp.getTime() / 1000);

      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.reportMeterEvent.mockResolvedValue(MOCK_STRIPE_METER_EVENT);
      usageRecordRepository.create.mockResolvedValue(MOCK_USAGE_RECORD);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.reportUsage({
        ...validReportParams,
        timestamp: customTimestamp,
      });

      expect(stripeUsageApiService.reportMeterEvent).toHaveBeenCalledWith({
        eventName: validReportParams.meterEventName,
        customerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        value: validReportParams.quantity,
        timestamp: expectedUnixTimestamp,
      });

      expect(usageRecordRepository.create).toHaveBeenCalledWith({
        subscriptionId: validReportParams.subscriptionId,
        meterId: validReportParams.meterId,
        meterEventName: validReportParams.meterEventName,
        quantity: validReportParams.quantity,
        timestamp: customTimestamp,
        stripeEventId: MOCK_STRIPE_METER_EVENT.identifier,
      });
    });

    it("should convert Date to Unix timestamp correctly using Math.floor and division by 1000", async () => {
      const customTimestamp = new Date("2025-01-20T15:30:45.678Z");
      const expectedUnixTimestamp = Math.floor(customTimestamp.getTime() / 1000);

      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.reportMeterEvent.mockResolvedValue(MOCK_STRIPE_METER_EVENT);
      usageRecordRepository.create.mockResolvedValue(MOCK_USAGE_RECORD);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.reportUsage({
        ...validReportParams,
        timestamp: customTimestamp,
      });

      expect(stripeUsageApiService.reportMeterEvent).toHaveBeenCalledWith({
        eventName: validReportParams.meterEventName,
        customerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        value: validReportParams.quantity,
        timestamp: expectedUnixTimestamp,
      });
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.reportUsage(validReportParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validReportParams.subscriptionId });
      expect(stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(stripeUsageApiService.reportMeterEvent).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentStripeCustomer = {
        ...MOCK_STRIPE_CUSTOMER,
        id: "different_customer_id",
      };
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(differentStripeCustomer);

      await expect(service.reportUsage(validReportParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeUsageApiService.reportMeterEvent).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when customer does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.reportUsage(validReportParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeUsageApiService.reportMeterEvent).not.toHaveBeenCalled();
    });

    it("should store stripeEventId from Stripe response", async () => {
      const customStripeEventId = "evt_custom_456";
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.reportMeterEvent.mockResolvedValue({
        ...MOCK_STRIPE_METER_EVENT,
        identifier: customStripeEventId,
      });
      usageRecordRepository.create.mockResolvedValue(MOCK_USAGE_RECORD);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.reportUsage(validReportParams);

      expect(usageRecordRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeEventId: customStripeEventId,
        }),
      );
    });

    it("should return JSON:API formatted response", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.reportMeterEvent.mockResolvedValue(MOCK_STRIPE_METER_EVENT);
      usageRecordRepository.create.mockResolvedValue(MOCK_USAGE_RECORD);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.reportUsage(validReportParams);

      expect(jsonApiService.buildSingle).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should report to Stripe before storing locally", async () => {
      const callOrder: string[] = [];
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.reportMeterEvent.mockImplementation(async () => {
        callOrder.push("stripe");
        return MOCK_STRIPE_METER_EVENT;
      });
      usageRecordRepository.create.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_USAGE_RECORD;
      });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.reportUsage(validReportParams);

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should not store locally if Stripe reporting fails", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      const stripeError = new Error("Stripe API error");
      stripeUsageApiService.reportMeterEvent.mockRejectedValue(stripeError);

      await expect(service.reportUsage(validReportParams)).rejects.toThrow("Stripe API error");

      expect(usageRecordRepository.create).not.toHaveBeenCalled();
    });
  });

  describe("listUsageRecords", () => {
    const validListParams = {
      companyId: TEST_IDS.companyId,
      subscriptionId: MOCK_SUBSCRIPTION.id,
      query: { page: { number: 1, size: 10 } },
    };

    it("should list usage records successfully", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.findBySubscriptionId.mockResolvedValue([MOCK_USAGE_RECORD]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      const result = await service.listUsageRecords(validListParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validListParams.subscriptionId });
      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: validListParams.companyId });
      expect(usageRecordRepository.findBySubscriptionId).toHaveBeenCalledWith({
        subscriptionId: validListParams.subscriptionId,
        startTime: undefined,
        endTime: undefined,
      });
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.listUsageRecords(validListParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentStripeCustomer = {
        ...MOCK_STRIPE_CUSTOMER,
        id: "different_customer_id",
      };
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(differentStripeCustomer);

      await expect(service.listUsageRecords(validListParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(usageRecordRepository.findBySubscriptionId).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when customer does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listUsageRecords(validListParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(usageRecordRepository.findBySubscriptionId).not.toHaveBeenCalled();
    });

    it("should support startTime filter", async () => {
      const startTime = new Date("2025-01-01T00:00:00Z");
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.findBySubscriptionId.mockResolvedValue([MOCK_USAGE_RECORD]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      await service.listUsageRecords({
        ...validListParams,
        startTime,
      });

      expect(usageRecordRepository.findBySubscriptionId).toHaveBeenCalledWith({
        subscriptionId: validListParams.subscriptionId,
        startTime,
        endTime: undefined,
      });
    });

    it("should support endTime filter", async () => {
      const endTime = new Date("2025-01-31T23:59:59Z");
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.findBySubscriptionId.mockResolvedValue([MOCK_USAGE_RECORD]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      await service.listUsageRecords({
        ...validListParams,
        endTime,
      });

      expect(usageRecordRepository.findBySubscriptionId).toHaveBeenCalledWith({
        subscriptionId: validListParams.subscriptionId,
        startTime: undefined,
        endTime,
      });
    });

    it("should support both startTime and endTime filters", async () => {
      const startTime = new Date("2025-01-01T00:00:00Z");
      const endTime = new Date("2025-01-31T23:59:59Z");
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.findBySubscriptionId.mockResolvedValue([MOCK_USAGE_RECORD]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      await service.listUsageRecords({
        ...validListParams,
        startTime,
        endTime,
      });

      expect(usageRecordRepository.findBySubscriptionId).toHaveBeenCalledWith({
        subscriptionId: validListParams.subscriptionId,
        startTime,
        endTime,
      });
    });

    it("should return paginated JSON:API response", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.findBySubscriptionId.mockResolvedValue([MOCK_USAGE_RECORD]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      const result = await service.listUsageRecords(validListParams);

      expect(jsonApiService.buildList).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });
  });

  describe("getUsageSummary", () => {
    const validSummaryParams = {
      companyId: TEST_IDS.companyId,
      subscriptionId: MOCK_SUBSCRIPTION.id,
      startTime: new Date("2025-01-01T00:00:00Z"),
      endTime: new Date("2025-01-31T23:59:59Z"),
    };

    const MOCK_REPOSITORY_SUMMARY = {
      total: 1500,
      count: 10,
      byMeter: {
        [TEST_IDS.meterId]: {
          total: 1500,
          count: 10,
        },
      },
    };

    it("should get usage summary successfully", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.getUsageSummary.mockResolvedValue(MOCK_REPOSITORY_SUMMARY);

      const result = await service.getUsageSummary(validSummaryParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validSummaryParams.subscriptionId });
      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validSummaryParams.companyId,
      });
      expect(usageRecordRepository.getUsageSummary).toHaveBeenCalledWith({
        subscriptionId: validSummaryParams.subscriptionId,
        startTime: validSummaryParams.startTime,
        endTime: validSummaryParams.endTime,
      });
      expect(result).toEqual({
        subscriptionId: validSummaryParams.subscriptionId,
        startTime: validSummaryParams.startTime.toISOString(),
        endTime: validSummaryParams.endTime.toISOString(),
        totalUsage: MOCK_REPOSITORY_SUMMARY.total,
        recordCount: MOCK_REPOSITORY_SUMMARY.count,
        byMeter: MOCK_REPOSITORY_SUMMARY.byMeter,
      });
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.getUsageSummary(validSummaryParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentStripeCustomer = {
        ...MOCK_STRIPE_CUSTOMER,
        id: "different_customer_id",
      };
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(differentStripeCustomer);

      await expect(service.getUsageSummary(validSummaryParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(usageRecordRepository.getUsageSummary).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when customer does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getUsageSummary(validSummaryParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(usageRecordRepository.getUsageSummary).not.toHaveBeenCalled();
    });

    it("should convert dates to ISO strings in response", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.getUsageSummary.mockResolvedValue(MOCK_REPOSITORY_SUMMARY);

      const result = await service.getUsageSummary(validSummaryParams);

      expect(result.startTime).toBe("2025-01-01T00:00:00.000Z");
      expect(result.endTime).toBe("2025-01-31T23:59:59.000Z");
    });

    it("should map repository response fields correctly", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.getUsageSummary.mockResolvedValue(MOCK_REPOSITORY_SUMMARY);

      const result = await service.getUsageSummary(validSummaryParams);

      // Verify mapping: total → totalUsage, count → recordCount
      expect(result.totalUsage).toBe(MOCK_REPOSITORY_SUMMARY.total);
      expect(result.recordCount).toBe(MOCK_REPOSITORY_SUMMARY.count);
      expect(result.byMeter).toBe(MOCK_REPOSITORY_SUMMARY.byMeter);
    });

    it("should require startTime and endTime", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      usageRecordRepository.getUsageSummary.mockResolvedValue(MOCK_REPOSITORY_SUMMARY);

      await service.getUsageSummary(validSummaryParams);

      expect(usageRecordRepository.getUsageSummary).toHaveBeenCalledWith({
        subscriptionId: validSummaryParams.subscriptionId,
        startTime: validSummaryParams.startTime,
        endTime: validSummaryParams.endTime,
      });
    });
  });

  describe("getMeterEventSummaries", () => {
    const validMeterSummaryParams = {
      companyId: TEST_IDS.companyId,
      meterId: TEST_IDS.meterId,
      startTime: new Date("2025-01-01T00:00:00Z"),
      endTime: new Date("2025-01-31T23:59:59Z"),
    };

    const MOCK_STRIPE_SUMMARIES = [
      {
        id: "summary_1",
        aggregated_value: 1500,
        start_time: 1704067200, // 2024-01-01T00:00:00Z
        end_time: 1706745599, // 2024-01-31T23:59:59Z
      },
      {
        id: "summary_2",
        aggregated_value: 2000,
        start_time: 1706745600, // 2024-02-01T00:00:00Z
        end_time: 1709251199, // 2024-02-29T23:59:59Z
      },
    ];

    it("should get meter event summaries successfully", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.getMeterEventSummaries.mockResolvedValue(MOCK_STRIPE_SUMMARIES);

      const result = await service.getMeterEventSummaries(validMeterSummaryParams);

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validMeterSummaryParams.companyId,
      });
      expect(stripeUsageApiService.getMeterEventSummaries).toHaveBeenCalledWith({
        meterId: validMeterSummaryParams.meterId,
        customerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        startTime: Math.floor(validMeterSummaryParams.startTime.getTime() / 1000),
        endTime: Math.floor(validMeterSummaryParams.endTime.getTime() / 1000),
      });
      expect(result).toEqual({
        meterId: validMeterSummaryParams.meterId,
        startTime: validMeterSummaryParams.startTime.toISOString(),
        endTime: validMeterSummaryParams.endTime.toISOString(),
        summaries: [
          {
            id: "summary_1",
            aggregatedValue: 1500,
            startTime: "2024-01-01T00:00:00.000Z",
            endTime: "2024-01-31T23:59:59.000Z",
          },
          {
            id: "summary_2",
            aggregatedValue: 2000,
            startTime: "2024-02-01T00:00:00.000Z",
            endTime: "2024-02-29T23:59:59.000Z",
          },
        ],
      });
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getMeterEventSummaries(validMeterSummaryParams)).rejects.toThrow(
        new HttpException("Stripe customer not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeUsageApiService.getMeterEventSummaries).not.toHaveBeenCalled();
    });

    it("should convert Date to Unix timestamp using Math.floor and division by 1000", async () => {
      const startTime = new Date("2025-01-15T10:30:45.678Z");
      const endTime = new Date("2025-01-20T18:45:30.123Z");
      const expectedStartUnix = Math.floor(startTime.getTime() / 1000);
      const expectedEndUnix = Math.floor(endTime.getTime() / 1000);

      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.getMeterEventSummaries.mockResolvedValue([]);

      await service.getMeterEventSummaries({
        ...validMeterSummaryParams,
        startTime,
        endTime,
      });

      expect(stripeUsageApiService.getMeterEventSummaries).toHaveBeenCalledWith({
        meterId: validMeterSummaryParams.meterId,
        customerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        startTime: expectedStartUnix,
        endTime: expectedEndUnix,
      });
    });

    it("should convert Unix timestamp to Date to ISO string in response", async () => {
      const testSummary = {
        id: "summary_test",
        aggregated_value: 500,
        start_time: 1737389445, // Should become "2025-01-20T15:30:45.000Z"
        end_time: 1737475845, // Should become "2025-01-21T15:30:45.000Z"
      };

      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.getMeterEventSummaries.mockResolvedValue([testSummary]);

      const result = await service.getMeterEventSummaries(validMeterSummaryParams);

      expect(result.summaries[0].startTime).toBe(new Date(1737389445 * 1000).toISOString());
      expect(result.summaries[0].endTime).toBe(new Date(1737475845 * 1000).toISOString());
    });

    it("should map Stripe summary fields correctly", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.getMeterEventSummaries.mockResolvedValue(MOCK_STRIPE_SUMMARIES);

      const result = await service.getMeterEventSummaries(validMeterSummaryParams);

      // Verify aggregated_value → aggregatedValue, start_time/end_time → Date → ISO string
      expect(result.summaries[0].aggregatedValue).toBe(MOCK_STRIPE_SUMMARIES[0].aggregated_value);
      expect(result.summaries[0].id).toBe(MOCK_STRIPE_SUMMARIES[0].id);
    });

    it("should handle empty summaries array", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeUsageApiService.getMeterEventSummaries.mockResolvedValue([]);

      const result = await service.getMeterEventSummaries(validMeterSummaryParams);

      expect(result.summaries).toEqual([]);
    });
  });

  describe("listMeters", () => {
    const MOCK_STRIPE_METERS = [
      {
        id: TEST_IDS.meterId,
        display_name: "API Calls",
        event_name: "api_call",
        status: "active",
        default_aggregation: { formula: "sum" },
      },
      {
        id: "mtr_test_456",
        display_name: "Storage Usage",
        event_name: "storage_usage",
        status: "active",
        default_aggregation: { formula: "last" },
      },
    ];

    it("should list meters successfully", async () => {
      stripeUsageApiService.listMeters.mockResolvedValue(MOCK_STRIPE_METERS);

      const result = await service.listMeters();

      expect(stripeUsageApiService.listMeters).toHaveBeenCalled();
      expect(result).toEqual({
        meters: [
          {
            id: TEST_IDS.meterId,
            displayName: "API Calls",
            eventName: "api_call",
            status: "active",
            valueSettings: { formula: "sum" },
          },
          {
            id: "mtr_test_456",
            displayName: "Storage Usage",
            eventName: "storage_usage",
            status: "active",
            valueSettings: { formula: "last" },
          },
        ],
      });
    });

    it("should map Stripe meter fields correctly", async () => {
      stripeUsageApiService.listMeters.mockResolvedValue(MOCK_STRIPE_METERS);

      const result = await service.listMeters();

      // Verify display_name → displayName, event_name → eventName, default_aggregation → valueSettings
      expect(result.meters[0].displayName).toBe(MOCK_STRIPE_METERS[0].display_name);
      expect(result.meters[0].eventName).toBe(MOCK_STRIPE_METERS[0].event_name);
      expect(result.meters[0].valueSettings).toBe(MOCK_STRIPE_METERS[0].default_aggregation);
    });

    it("should handle empty meters array", async () => {
      stripeUsageApiService.listMeters.mockResolvedValue([]);

      const result = await service.listMeters();

      expect(result.meters).toEqual([]);
    });

    it("should propagate Stripe API errors", async () => {
      const stripeError = new Error("Failed to list meters");
      stripeUsageApiService.listMeters.mockRejectedValue(stripeError);

      await expect(service.listMeters()).rejects.toThrow("Failed to list meters");
    });
  });
});
