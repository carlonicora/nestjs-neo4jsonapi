import { Test, TestingModule } from "@nestjs/testing";
import { StripeInvoiceApiService } from "../stripe-invoice-api.service";
import { StripeService } from "../../../stripe/services/stripe.service";
import { StripeError } from "../../../stripe/errors/stripe.errors";
import { createMockStripeClient, MockStripeClient } from "../../../stripe/__tests__/mocks/stripe.mock";
import {
  MOCK_INVOICE,
  TEST_IDS,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_API_ERROR,
} from "../../../stripe/__tests__/fixtures/stripe.fixtures";
import Stripe from "stripe";

describe("StripeInvoiceApiService", () => {
  let service: StripeInvoiceApiService;
  let stripeService: jest.Mocked<StripeService>;
  let mockStripe: MockStripeClient;

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const mockStripeService = {
      getClient: jest.fn().mockReturnValue(mockStripe),
      isConfigured: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeInvoiceApiService,
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    service = module.get<StripeInvoiceApiService>(StripeInvoiceApiService);
    stripeService = module.get(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("retrieveInvoice", () => {
    it("should retrieve invoice successfully", async () => {
      mockStripe.invoices.retrieve.mockResolvedValue(MOCK_INVOICE);

      const result = await service.retrieveInvoice(TEST_IDS.invoiceId);

      expect(mockStripe.invoices.retrieve).toHaveBeenCalledWith(TEST_IDS.invoiceId);
      expect(result).toEqual(MOCK_INVOICE);
    });

    it("should retrieve invoice with different statuses", async () => {
      const paidInvoice = { ...MOCK_INVOICE, status: "paid", paid: true };
      mockStripe.invoices.retrieve.mockResolvedValue(paidInvoice as any);

      const result = await service.retrieveInvoice(TEST_IDS.invoiceId);

      expect(result.status).toBe("paid");
      expect(result.paid).toBe(true);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.invoices.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.retrieveInvoice(TEST_IDS.invoiceId)).rejects.toThrow(StripeError);
    });

    it("should handle invalid invoice ID errors", async () => {
      mockStripe.invoices.retrieve.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.retrieveInvoice("invalid_invoice_id")).rejects.toThrow(StripeError);
    });
  });

  describe("listInvoices", () => {
    const validParams = {
      stripeCustomerId: TEST_IDS.customerId,
    };

    it("should list invoices with default params", async () => {
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [MOCK_INVOICE],
        has_more: false,
        url: "/v1/invoices",
      });

      const result = await service.listInvoices(validParams);

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 100,
      });
      expect(result).toEqual([MOCK_INVOICE]);
    });

    it("should list invoices with custom limit", async () => {
      const paramsWithLimit = {
        ...validParams,
        limit: 50,
      };
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [MOCK_INVOICE],
        has_more: false,
        url: "/v1/invoices",
      });

      await service.listInvoices(paramsWithLimit);

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 50,
      });
    });

    it("should list invoices with status filter", async () => {
      const paramsWithStatus = {
        ...validParams,
        status: "paid" as Stripe.InvoiceListParams.Status,
      };
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [MOCK_INVOICE],
        has_more: false,
        url: "/v1/invoices",
      });

      await service.listInvoices(paramsWithStatus);

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 100,
        status: "paid",
      });
    });

    it("should list invoices with draft status", async () => {
      const paramsWithDraft = {
        ...validParams,
        status: "draft" as Stripe.InvoiceListParams.Status,
      };
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [MOCK_INVOICE],
        has_more: false,
        url: "/v1/invoices",
      });

      await service.listInvoices(paramsWithDraft);

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 100,
        status: "draft",
      });
    });

    it("should list invoices with open status", async () => {
      const paramsWithOpen = {
        ...validParams,
        status: "open" as Stripe.InvoiceListParams.Status,
      };
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [MOCK_INVOICE],
        has_more: false,
        url: "/v1/invoices",
      });

      await service.listInvoices(paramsWithOpen);

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 100,
        status: "open",
      });
    });

    it("should list invoices with void status", async () => {
      const paramsWithVoid = {
        ...validParams,
        status: "void" as Stripe.InvoiceListParams.Status,
      };
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [MOCK_INVOICE],
        has_more: false,
        url: "/v1/invoices",
      });

      await service.listInvoices(paramsWithVoid);

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 100,
        status: "void",
      });
    });

    it("should return empty array when no invoices", async () => {
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/invoices",
      });

      const result = await service.listInvoices(validParams);

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should return multiple invoices", async () => {
      const multipleInvoices = [
        MOCK_INVOICE,
        { ...MOCK_INVOICE, id: "in_test_second" },
        { ...MOCK_INVOICE, id: "in_test_third" },
      ];
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: multipleInvoices,
        has_more: false,
        url: "/v1/invoices",
      });

      const result = await service.listInvoices(validParams);

      expect(result).toEqual(multipleInvoices);
      expect(result.length).toBe(3);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.invoices.list.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.listInvoices(validParams)).rejects.toThrow(StripeError);
    });
  });

  describe("getInvoice", () => {
    it("should get invoice with expanded line items", async () => {
      const invoiceWithLines = {
        ...MOCK_INVOICE,
        lines: {
          object: "list" as const,
          data: [
            {
              id: "il_test_123",
              object: "line_item" as const,
              amount: 999,
              currency: "usd",
              description: "Test line item",
              discount_amounts: [],
              discountable: true,
              discounts: [],
              livemode: false,
              metadata: {},
              period: {
                start: Math.floor(Date.now() / 1000),
                end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
              },
              plan: null,
              price: null,
              proration: false,
              proration_details: {
                credited_items: null,
              },
              quantity: 1,
              subscription: TEST_IDS.subscriptionId,
              subscription_item: "si_test_123",
              tax_amounts: [],
              tax_rates: [],
              type: "subscription" as const,
              unit_amount_excluding_tax: null,
            },
          ],
          has_more: false,
          url: "/v1/invoices/in_test_123/lines",
        },
      };
      mockStripe.invoices.retrieve.mockResolvedValue(invoiceWithLines as any);

      const result = await service.getInvoice(TEST_IDS.invoiceId);

      expect(mockStripe.invoices.retrieve).toHaveBeenCalledWith(TEST_IDS.invoiceId, {
        expand: ["lines.data"],
      });
      expect(result.lines.data.length).toBeGreaterThan(0);
    });

    it("should handle invoice with no line items", async () => {
      mockStripe.invoices.retrieve.mockResolvedValue(MOCK_INVOICE);

      const result = await service.getInvoice(TEST_IDS.invoiceId);

      expect(result.lines.data.length).toBe(0);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.invoices.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.getInvoice(TEST_IDS.invoiceId)).rejects.toThrow(StripeError);
    });
  });

  describe("getUpcomingInvoice", () => {
    const mockUpcomingInvoice: Stripe.UpcomingInvoice = {
      ...MOCK_INVOICE,
      id: null,
      number: null,
      status: null,
      status_transitions: {
        finalized_at: null,
        marked_uncollectible_at: null,
        paid_at: null,
        voided_at: null,
      },
    } as any;

    it("should get upcoming invoice for customer", async () => {
      mockStripe.invoices.createPreview.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.getUpcomingInvoice({
        customerId: TEST_IDS.customerId,
      });

      expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
      });
      expect(result).toEqual(mockUpcomingInvoice);
    });

    it("should get upcoming invoice with subscription ID", async () => {
      mockStripe.invoices.createPreview.mockResolvedValue(mockUpcomingInvoice);

      await service.getUpcomingInvoice({
        customerId: TEST_IDS.customerId,
        subscriptionId: TEST_IDS.subscriptionId,
      });

      expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        subscription: TEST_IDS.subscriptionId,
      });
    });

    it("should get upcoming invoice without subscription", async () => {
      mockStripe.invoices.createPreview.mockResolvedValue(mockUpcomingInvoice);

      await service.getUpcomingInvoice({
        customerId: TEST_IDS.customerId,
      });

      expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
      });
    });

    it("should handle customer with no upcoming invoice", async () => {
      mockStripe.invoices.createPreview.mockRejectedValue({
        ...STRIPE_INVALID_REQUEST_ERROR,
        message: "No upcoming invoices for customer",
      });

      await expect(
        service.getUpcomingInvoice({
          customerId: TEST_IDS.customerId,
        }),
      ).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.invoices.createPreview.mockRejectedValue(STRIPE_API_ERROR);

      await expect(
        service.getUpcomingInvoice({
          customerId: TEST_IDS.customerId,
        }),
      ).rejects.toThrow(StripeError);
    });
  });

  describe("payInvoice", () => {
    it("should pay invoice successfully", async () => {
      const paidInvoice = { ...MOCK_INVOICE, status: "paid", paid: true };
      mockStripe.invoices.pay.mockResolvedValue(paidInvoice as any);

      const result = await service.payInvoice(TEST_IDS.invoiceId);

      expect(mockStripe.invoices.pay).toHaveBeenCalledWith(TEST_IDS.invoiceId);
      expect(result.status).toBe("paid");
      expect(result.paid).toBe(true);
    });

    it("should handle invoice already paid", async () => {
      mockStripe.invoices.pay.mockRejectedValue({
        ...STRIPE_INVALID_REQUEST_ERROR,
        message: "Invoice is already paid",
      });

      await expect(service.payInvoice(TEST_IDS.invoiceId)).rejects.toThrow(StripeError);
    });

    it("should handle payment failure", async () => {
      mockStripe.invoices.pay.mockRejectedValue({
        ...STRIPE_INVALID_REQUEST_ERROR,
        message: "Your card was declined",
      });

      await expect(service.payInvoice(TEST_IDS.invoiceId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.invoices.pay.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.payInvoice(TEST_IDS.invoiceId)).rejects.toThrow(StripeError);
    });
  });

  describe("voidInvoice", () => {
    it("should void invoice successfully", async () => {
      const voidedInvoice = {
        ...MOCK_INVOICE,
        status: "void",
        status_transitions: {
          ...MOCK_INVOICE.status_transitions,
          voided_at: Math.floor(Date.now() / 1000),
        },
      };
      mockStripe.invoices.voidInvoice.mockResolvedValue(voidedInvoice as any);

      const result = await service.voidInvoice(TEST_IDS.invoiceId);

      expect(mockStripe.invoices.voidInvoice).toHaveBeenCalledWith(TEST_IDS.invoiceId);
      expect(result.status).toBe("void");
    });

    it("should handle invoice already voided", async () => {
      mockStripe.invoices.voidInvoice.mockRejectedValue({
        ...STRIPE_INVALID_REQUEST_ERROR,
        message: "Invoice is already void",
      });

      await expect(service.voidInvoice(TEST_IDS.invoiceId)).rejects.toThrow(StripeError);
    });

    it("should handle paid invoice that cannot be voided", async () => {
      mockStripe.invoices.voidInvoice.mockRejectedValue({
        ...STRIPE_INVALID_REQUEST_ERROR,
        message: "You cannot void this invoice because it has been paid",
      });

      await expect(service.voidInvoice(TEST_IDS.invoiceId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.invoices.voidInvoice.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.voidInvoice(TEST_IDS.invoiceId)).rejects.toThrow(StripeError);
    });
  });

  describe("Edge Cases", () => {
    it("should handle invoice with zero amount", async () => {
      const zeroAmountInvoice = { ...MOCK_INVOICE, amount_due: 0, total: 0 };
      mockStripe.invoices.retrieve.mockResolvedValue(zeroAmountInvoice as any);

      const result = await service.retrieveInvoice(TEST_IDS.invoiceId);

      expect(result.amount_due).toBe(0);
      expect(result.total).toBe(0);
    });

    it("should handle invoice with partial payment", async () => {
      const partiallyPaidInvoice = {
        ...MOCK_INVOICE,
        amount_paid: 500,
        amount_remaining: 499,
      };
      mockStripe.invoices.retrieve.mockResolvedValue(partiallyPaidInvoice as any);

      const result = await service.retrieveInvoice(TEST_IDS.invoiceId);

      expect(result.amount_paid).toBe(500);
      expect(result.amount_remaining).toBe(499);
    });

    it("should handle list with custom small limit", async () => {
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [MOCK_INVOICE],
        has_more: true,
        url: "/v1/invoices",
      });

      await service.listInvoices({
        stripeCustomerId: TEST_IDS.customerId,
        limit: 1,
      });

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 1,
      });
    });

    it("should handle list with large limit", async () => {
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/invoices",
      });

      await service.listInvoices({
        stripeCustomerId: TEST_IDS.customerId,
        limit: 999,
      });

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 999,
      });
    });

    it("should handle invoice without subscription", async () => {
      const invoiceWithoutSub = { ...MOCK_INVOICE, subscription: null };
      mockStripe.invoices.retrieve.mockResolvedValue(invoiceWithoutSub as any);

      const result = await service.retrieveInvoice(TEST_IDS.invoiceId);

      expect(result.subscription).toBeNull();
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact customer ID in list", async () => {
      const exactCustomerId = "cus_exact_test_789";
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/invoices",
      });

      await service.listInvoices({
        stripeCustomerId: exactCustomerId,
      });

      expect(mockStripe.invoices.list).toHaveBeenCalledWith({
        customer: exactCustomerId,
        limit: 100,
      });
    });

    it("should preserve exact invoice ID in retrieve", async () => {
      const exactInvoiceId = "in_exact_test_456";
      mockStripe.invoices.retrieve.mockResolvedValue(MOCK_INVOICE);

      await service.retrieveInvoice(exactInvoiceId);

      expect(mockStripe.invoices.retrieve).toHaveBeenCalledWith(exactInvoiceId);
    });

    it("should preserve exact parameters in upcoming invoice", async () => {
      const exactParams = {
        customerId: "cus_exact_123",
        subscriptionId: "sub_exact_456",
      };
      mockStripe.invoices.createPreview.mockResolvedValue({} as any);

      await service.getUpcomingInvoice(exactParams);

      expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith({
        customer: "cus_exact_123",
        subscription: "sub_exact_456",
      });
    });
  });

  describe("Service Integration", () => {
    it("should use StripeService to get client", async () => {
      mockStripe.invoices.retrieve.mockResolvedValue(MOCK_INVOICE);

      await service.retrieveInvoice(TEST_IDS.invoiceId);

      expect(stripeService.getClient).toHaveBeenCalled();
    });

    it("should call getClient before each operation", async () => {
      mockStripe.invoices.retrieve.mockResolvedValue(MOCK_INVOICE);
      mockStripe.invoices.list.mockResolvedValue({
        object: "list",
        data: [MOCK_INVOICE],
        has_more: false,
        url: "/v1/invoices",
      });
      mockStripe.invoices.createPreview.mockResolvedValue({} as any);
      mockStripe.invoices.pay.mockResolvedValue(MOCK_INVOICE);
      mockStripe.invoices.voidInvoice.mockResolvedValue(MOCK_INVOICE);

      await service.retrieveInvoice(TEST_IDS.invoiceId);
      await service.listInvoices({ stripeCustomerId: TEST_IDS.customerId });
      await service.getInvoice(TEST_IDS.invoiceId);
      await service.getUpcomingInvoice({ customerId: TEST_IDS.customerId });
      await service.payInvoice(TEST_IDS.invoiceId);
      await service.voidInvoice(TEST_IDS.invoiceId);

      expect(stripeService.getClient).toHaveBeenCalledTimes(6);
    });
  });
});
