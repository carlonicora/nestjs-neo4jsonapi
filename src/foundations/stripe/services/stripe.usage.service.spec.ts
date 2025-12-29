import { Test, TestingModule } from "@nestjs/testing";
import { StripeUsageService } from "./stripe.usage.service";
import { StripeService } from "./stripe.service";
import { StripeError } from "../errors/stripe.errors";
import { createMockStripeClient, MockStripeClient } from "../__tests__/mocks/stripe.mock";
import {
  MOCK_SUBSCRIPTION,
  TEST_IDS,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_API_ERROR,
} from "../__tests__/fixtures/stripe.fixtures";
import Stripe from "stripe";

describe("StripeUsageService", () => {
  let service: StripeUsageService;
  let stripeService: jest.Mocked<StripeService>;
  let mockStripe: MockStripeClient;

  const MOCK_METER_EVENT: Stripe.V2.Billing.MeterEvent = {
    identifier: "meter_event_test_123",
    created: new Date().toISOString(),
    event_name: "api_requests",
    livemode: false,
    payload: {
      stripe_customer_id: TEST_IDS.customerId,
      value: "100",
    },
  };

  const MOCK_METER_EVENT_SUMMARY: Stripe.Billing.MeterEventSummary = {
    id: "mees_test_123",
    object: "billing.meter_event_summary",
    aggregated_value: 1000,
    livemode: false,
    start_time: Math.floor(Date.now() / 1000) - 86400,
    end_time: Math.floor(Date.now() / 1000),
  };

  const MOCK_METER: Stripe.Billing.Meter = {
    id: TEST_IDS.meterId,
    object: "billing.meter",
    created: Math.floor(Date.now() / 1000),
    customer_mapping: {
      event_payload_key: "stripe_customer_id",
      type: "by_id",
    },
    default_aggregation: {
      formula: "sum",
    },
    display_name: "API Requests",
    event_name: "api_requests",
    event_time_window: null,
    livemode: false,
    status: "active",
    status_transitions: {
      deactivated_at: null,
    },
    updated: Math.floor(Date.now() / 1000),
    value_settings: {
      event_payload_key: "value",
    },
  };

  const MOCK_SUBSCRIPTION_ITEM: Stripe.SubscriptionItem = {
    id: "si_test_metered_123",
    object: "subscription_item",
    billing_thresholds: null,
    created: Math.floor(Date.now() / 1000),
    discounts: [],
    metadata: {},
    price: {
      id: "price_test_metered",
      object: "price",
      active: true,
      billing_scheme: "per_unit",
      created: Math.floor(Date.now() / 1000),
      currency: "usd",
      currency_options: null,
      custom_unit_amount: null,
      livemode: false,
      lookup_key: null,
      metadata: {},
      nickname: "Metered Usage",
      product: TEST_IDS.productId,
      recurring: {
        aggregate_usage: "sum",
        interval: "month",
        interval_count: 1,
        meter: TEST_IDS.meterId,
        trial_period_days: null,
        usage_type: "metered",
      },
      tax_behavior: "unspecified",
      tiers_mode: null,
      transform_quantity: null,
      type: "recurring",
      unit_amount: 100,
      unit_amount_decimal: "100",
    },
    quantity: 1,
    subscription: TEST_IDS.subscriptionId,
    tax_rates: [],
  };

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const mockStripeService = {
      getClient: jest.fn().mockReturnValue(mockStripe),
      isConfigured: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeUsageService,
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    service = module.get<StripeUsageService>(StripeUsageService);
    stripeService = module.get(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("reportMeterEvent", () => {
    const validParams = {
      eventName: "api_requests",
      customerId: TEST_IDS.customerId,
      value: 100,
    };

    it("should report meter event with required params", async () => {
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      const result = await service.reportMeterEvent(validParams);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith({
        event_name: validParams.eventName,
        payload: {
          stripe_customer_id: validParams.customerId,
          value: "100",
        },
        identifier: undefined,
        timestamp: undefined,
      });
      expect(result).toEqual(MOCK_METER_EVENT);
    });

    it("should report meter event with timestamp", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const paramsWithTimestamp = {
        ...validParams,
        timestamp,
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(paramsWithTimestamp);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith({
        event_name: validParams.eventName,
        payload: {
          stripe_customer_id: validParams.customerId,
          value: "100",
        },
        identifier: undefined,
        timestamp: new Date(timestamp * 1000).toISOString(),
      });
    });

    it("should report meter event with identifier", async () => {
      const paramsWithIdentifier = {
        ...validParams,
        identifier: "unique_event_id_123",
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(paramsWithIdentifier);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith({
        event_name: validParams.eventName,
        payload: {
          stripe_customer_id: validParams.customerId,
          value: "100",
        },
        identifier: "unique_event_id_123",
        timestamp: undefined,
      });
    });

    it("should report meter event with all optional params", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const completeParams = {
        ...validParams,
        timestamp,
        identifier: "complete_event_123",
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(completeParams);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith({
        event_name: validParams.eventName,
        payload: {
          stripe_customer_id: validParams.customerId,
          value: "100",
        },
        identifier: "complete_event_123",
        timestamp: new Date(timestamp * 1000).toISOString(),
      });
    });

    it("should convert numeric value to string", async () => {
      const paramsWithLargeValue = {
        ...validParams,
        value: 999999,
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(paramsWithLargeValue);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: {
            stripe_customer_id: validParams.customerId,
            value: "999999",
          },
        }),
      );
    });

    it("should handle different event names", async () => {
      const customEventParams = {
        ...validParams,
        eventName: "custom_metric_name",
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(customEventParams);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          event_name: "custom_metric_name",
        }),
      );
    });

    it("should handle zero value", async () => {
      const zeroValueParams = {
        ...validParams,
        value: 0,
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(zeroValueParams);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: {
            stripe_customer_id: validParams.customerId,
            value: "0",
          },
        }),
      );
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.v2.billing.meterEvents.create.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.reportMeterEvent(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle invalid request errors", async () => {
      mockStripe.v2.billing.meterEvents.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.reportMeterEvent(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle duplicate identifier errors", async () => {
      const duplicateError = {
        ...STRIPE_INVALID_REQUEST_ERROR,
        message: "Duplicate meter event identifier",
      };
      mockStripe.v2.billing.meterEvents.create.mockRejectedValue(duplicateError);

      await expect(
        service.reportMeterEvent({
          ...validParams,
          identifier: "duplicate_id",
        }),
      ).rejects.toThrow(StripeError);
    });
  });

  describe("getMeterEventSummaries", () => {
    const validParams = {
      meterId: TEST_IDS.meterId,
      customerId: TEST_IDS.customerId,
      startTime: Math.floor(Date.now() / 1000) - 86400,
      endTime: Math.floor(Date.now() / 1000),
    };

    it("should get meter event summaries successfully", async () => {
      mockStripe.billing.meters.listEventSummaries.mockResolvedValue({
        object: "list",
        data: [MOCK_METER_EVENT_SUMMARY],
        has_more: false,
        url: "/v1/billing/meters/meter_test_123/event_summaries",
      });

      const result = await service.getMeterEventSummaries(validParams);

      expect(mockStripe.billing.meters.listEventSummaries).toHaveBeenCalledWith(validParams.meterId, {
        customer: validParams.customerId,
        start_time: validParams.startTime,
        end_time: validParams.endTime,
      });
      expect(result).toEqual([MOCK_METER_EVENT_SUMMARY]);
    });

    it("should return empty array when no summaries", async () => {
      mockStripe.billing.meters.listEventSummaries.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/billing/meters/meter_test_123/event_summaries",
      });

      const result = await service.getMeterEventSummaries(validParams);

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should return multiple summaries", async () => {
      const multipleSummaries = [
        MOCK_METER_EVENT_SUMMARY,
        { ...MOCK_METER_EVENT_SUMMARY, id: "mees_test_second", aggregated_value: 2000 },
        { ...MOCK_METER_EVENT_SUMMARY, id: "mees_test_third", aggregated_value: 3000 },
      ];
      mockStripe.billing.meters.listEventSummaries.mockResolvedValue({
        object: "list",
        data: multipleSummaries,
        has_more: false,
        url: "/v1/billing/meters/meter_test_123/event_summaries",
      });

      const result = await service.getMeterEventSummaries(validParams);

      expect(result).toEqual(multipleSummaries);
      expect(result.length).toBe(3);
    });

    it("should handle different time ranges", async () => {
      const customTimeParams = {
        ...validParams,
        startTime: Math.floor(Date.now() / 1000) - 604800, // 7 days ago
        endTime: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
      };
      mockStripe.billing.meters.listEventSummaries.mockResolvedValue({
        object: "list",
        data: [MOCK_METER_EVENT_SUMMARY],
        has_more: false,
        url: "/v1/billing/meters/meter_test_123/event_summaries",
      });

      await service.getMeterEventSummaries(customTimeParams);

      expect(mockStripe.billing.meters.listEventSummaries).toHaveBeenCalledWith(validParams.meterId, {
        customer: validParams.customerId,
        start_time: customTimeParams.startTime,
        end_time: customTimeParams.endTime,
      });
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.billing.meters.listEventSummaries.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.getMeterEventSummaries(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle invalid meter ID errors", async () => {
      mockStripe.billing.meters.listEventSummaries.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(
        service.getMeterEventSummaries({
          ...validParams,
          meterId: "invalid_meter_id",
        }),
      ).rejects.toThrow(StripeError);
    });
  });

  describe("listMeters", () => {
    it("should list all meters successfully", async () => {
      mockStripe.billing.meters.list.mockResolvedValue({
        object: "list",
        data: [MOCK_METER],
        has_more: false,
        url: "/v1/billing/meters",
      });

      const result = await service.listMeters();

      expect(mockStripe.billing.meters.list).toHaveBeenCalled();
      expect(result).toEqual([MOCK_METER]);
    });

    it("should return empty array when no meters", async () => {
      mockStripe.billing.meters.list.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/billing/meters",
      });

      const result = await service.listMeters();

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should return multiple meters", async () => {
      const multipleMeters = [
        MOCK_METER,
        {
          ...MOCK_METER,
          id: "meter_test_second",
          event_name: "storage_usage",
          display_name: "Storage Usage",
        },
        {
          ...MOCK_METER,
          id: "meter_test_third",
          event_name: "bandwidth_usage",
          display_name: "Bandwidth Usage",
        },
      ];
      mockStripe.billing.meters.list.mockResolvedValue({
        object: "list",
        data: multipleMeters,
        has_more: false,
        url: "/v1/billing/meters",
      });

      const result = await service.listMeters();

      expect(result).toEqual(multipleMeters);
      expect(result.length).toBe(3);
    });

    it("should handle meters with different statuses", async () => {
      const deactivatedMeter = {
        ...MOCK_METER,
        status: "inactive" as const,
        status_transitions: {
          deactivated_at: Math.floor(Date.now() / 1000),
        },
      };
      mockStripe.billing.meters.list.mockResolvedValue({
        object: "list",
        data: [deactivatedMeter],
        has_more: false,
        url: "/v1/billing/meters",
      });

      const result = await service.listMeters();

      expect(result[0].status).toBe("inactive");
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.billing.meters.list.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.listMeters()).rejects.toThrow(StripeError);
    });
  });

  describe("getSubscriptionItemForMeteredBilling", () => {
    it("should find subscription item with metered billing", async () => {
      const subscriptionWithMetered = {
        ...MOCK_SUBSCRIPTION,
        items: {
          object: "list" as const,
          data: [MOCK_SUBSCRIPTION_ITEM],
          has_more: false,
          url: "/v1/subscription_items",
        },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(subscriptionWithMetered as any);

      const result = await service.getSubscriptionItemForMeteredBilling(TEST_IDS.subscriptionId);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        expand: ["items.data.price"],
      });
      expect(result).toEqual(MOCK_SUBSCRIPTION_ITEM);
    });

    it("should return null when no metered items exist", async () => {
      const subscriptionWithoutMetered = {
        ...MOCK_SUBSCRIPTION,
        items: {
          object: "list" as const,
          data: [
            {
              ...MOCK_SUBSCRIPTION_ITEM,
              price: {
                ...MOCK_SUBSCRIPTION_ITEM.price,
                recurring: {
                  aggregate_usage: null,
                  interval: "month",
                  interval_count: 1,
                  meter: null,
                  trial_period_days: null,
                  usage_type: "licensed",
                },
              },
            },
          ],
          has_more: false,
          url: "/v1/subscription_items",
        },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(subscriptionWithoutMetered as any);

      const result = await service.getSubscriptionItemForMeteredBilling(TEST_IDS.subscriptionId);

      expect(result).toBeNull();
    });

    it("should return first metered item when multiple exist", async () => {
      const subscriptionWithMultipleMetered = {
        ...MOCK_SUBSCRIPTION,
        items: {
          object: "list" as const,
          data: [MOCK_SUBSCRIPTION_ITEM, { ...MOCK_SUBSCRIPTION_ITEM, id: "si_test_metered_second" }],
          has_more: false,
          url: "/v1/subscription_items",
        },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(subscriptionWithMultipleMetered as any);

      const result = await service.getSubscriptionItemForMeteredBilling(TEST_IDS.subscriptionId);

      expect(result?.id).toBe("si_test_metered_123");
    });

    it("should return null for subscription with no items", async () => {
      const subscriptionWithNoItems = {
        ...MOCK_SUBSCRIPTION,
        items: {
          object: "list" as const,
          data: [],
          has_more: false,
          url: "/v1/subscription_items",
        },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(subscriptionWithNoItems as any);

      const result = await service.getSubscriptionItemForMeteredBilling(TEST_IDS.subscriptionId);

      expect(result).toBeNull();
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.subscriptions.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.getSubscriptionItemForMeteredBilling(TEST_IDS.subscriptionId)).rejects.toThrow(StripeError);
    });

    it("should handle invalid subscription ID errors", async () => {
      mockStripe.subscriptions.retrieve.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.getSubscriptionItemForMeteredBilling("invalid_sub_id")).rejects.toThrow(StripeError);
    });
  });

  describe("Edge Cases", () => {
    it("should handle meter event with decimal value converted to string", async () => {
      const decimalParams = {
        eventName: "api_requests",
        customerId: TEST_IDS.customerId,
        value: 99.99,
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(decimalParams);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: {
            stripe_customer_id: TEST_IDS.customerId,
            value: "99.99",
          },
        }),
      );
    });

    it("should handle meter event summaries with zero aggregated value", async () => {
      const zeroSummary = { ...MOCK_METER_EVENT_SUMMARY, aggregated_value: 0 };
      mockStripe.billing.meters.listEventSummaries.mockResolvedValue({
        object: "list",
        data: [zeroSummary],
        has_more: false,
        url: "/v1/billing/meters/meter_test_123/event_summaries",
      });

      const result = await service.getMeterEventSummaries({
        meterId: TEST_IDS.meterId,
        customerId: TEST_IDS.customerId,
        startTime: Math.floor(Date.now() / 1000) - 86400,
        endTime: Math.floor(Date.now() / 1000),
      });

      expect(result[0].aggregated_value).toBe(0);
    });

    it("should handle timestamp at epoch", async () => {
      const epochParams = {
        eventName: "api_requests",
        customerId: TEST_IDS.customerId,
        value: 100,
        timestamp: 0,
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(epochParams);

      // When timestamp is 0 (falsy), it's set to undefined
      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: undefined,
        }),
      );
    });

    it("should handle very large aggregated values", async () => {
      const largeSummary = { ...MOCK_METER_EVENT_SUMMARY, aggregated_value: 999999999999 };
      mockStripe.billing.meters.listEventSummaries.mockResolvedValue({
        object: "list",
        data: [largeSummary],
        has_more: false,
        url: "/v1/billing/meters/meter_test_123/event_summaries",
      });

      const result = await service.getMeterEventSummaries({
        meterId: TEST_IDS.meterId,
        customerId: TEST_IDS.customerId,
        startTime: Math.floor(Date.now() / 1000) - 86400,
        endTime: Math.floor(Date.now() / 1000),
      });

      expect(result[0].aggregated_value).toBe(999999999999);
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact event name", async () => {
      const exactParams = {
        eventName: "exact_custom_event_name",
        customerId: "cus_exact_123",
        value: 12345,
      };
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent(exactParams);

      expect(mockStripe.v2.billing.meterEvents.create).toHaveBeenCalledWith({
        event_name: "exact_custom_event_name",
        payload: {
          stripe_customer_id: "cus_exact_123",
          value: "12345",
        },
        identifier: undefined,
        timestamp: undefined,
      });
    });

    it("should preserve exact meter ID and customer ID", async () => {
      const exactParams = {
        meterId: "meter_exact_456",
        customerId: "cus_exact_789",
        startTime: 1234567890,
        endTime: 1234654290,
      };
      mockStripe.billing.meters.listEventSummaries.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/billing/meters/meter_exact_456/event_summaries",
      });

      await service.getMeterEventSummaries(exactParams);

      expect(mockStripe.billing.meters.listEventSummaries).toHaveBeenCalledWith("meter_exact_456", {
        customer: "cus_exact_789",
        start_time: 1234567890,
        end_time: 1234654290,
      });
    });

    it("should preserve exact subscription ID", async () => {
      const exactSubId = "sub_exact_test_999";
      mockStripe.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.getSubscriptionItemForMeteredBilling(exactSubId);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(exactSubId, {
        expand: ["items.data.price"],
      });
    });
  });

  describe("Service Integration", () => {
    it("should use StripeService to get client", async () => {
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);

      await service.reportMeterEvent({
        eventName: "api_requests",
        customerId: TEST_IDS.customerId,
        value: 100,
      });

      expect(stripeService.getClient).toHaveBeenCalled();
    });

    it("should call getClient before each operation", async () => {
      mockStripe.v2.billing.meterEvents.create.mockResolvedValue(MOCK_METER_EVENT);
      mockStripe.billing.meters.listEventSummaries.mockResolvedValue({
        object: "list",
        data: [MOCK_METER_EVENT_SUMMARY],
        has_more: false,
        url: "/v1/billing/meters/meter_test_123/event_summaries",
      });
      mockStripe.billing.meters.list.mockResolvedValue({
        object: "list",
        data: [MOCK_METER],
        has_more: false,
        url: "/v1/billing/meters",
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.reportMeterEvent({
        eventName: "api_requests",
        customerId: TEST_IDS.customerId,
        value: 100,
      });
      await service.getMeterEventSummaries({
        meterId: TEST_IDS.meterId,
        customerId: TEST_IDS.customerId,
        startTime: Math.floor(Date.now() / 1000) - 86400,
        endTime: Math.floor(Date.now() / 1000),
      });
      await service.listMeters();
      await service.getSubscriptionItemForMeteredBilling(TEST_IDS.subscriptionId);

      expect(stripeService.getClient).toHaveBeenCalledTimes(4);
    });
  });
});
