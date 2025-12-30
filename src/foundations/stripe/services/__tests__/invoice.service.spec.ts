// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide the imports that InvoiceService needs
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = jest.requireActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
    // Override companyMeta that billing-customer.model needs
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
    // Mock StripeInvoiceService to avoid dependency resolution issues
    StripeInvoiceService: jest.fn().mockImplementation(() => ({
      getInvoice: jest.fn(),
      getUpcomingInvoice: jest.fn(),
    })),
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import Stripe from "stripe";
import { InvoiceService } from "../invoice.service";
import { InvoiceRepository } from "../../repositories/invoice.repository";
import { BillingCustomerRepository } from "../../repositories/billing-customer.repository";
import { StripeSubscriptionRepository } from "../../../stripe-subscription/repositories/stripe-subscription.repository";
import { JsonApiService } from "../../../../core/jsonapi";
import { StripeInvoiceService } from "../stripe.invoice.service";
import { Invoice, InvoiceStatus } from "../../entities/invoice.entity";
import { BillingCustomer } from "../../entities/billing-customer.entity";
import { StripeSubscription } from "../../../stripe-subscription/entities/stripe-subscription.entity";
import { MOCK_INVOICE, TEST_IDS } from "../../__tests__/fixtures/stripe.fixtures";

describe("InvoiceService", () => {
  let service: InvoiceService;
  let invoiceRepository: jest.Mocked<InvoiceRepository>;
  let billingCustomerRepository: jest.Mocked<BillingCustomerRepository>;
  let subscriptionRepository: jest.Mocked<StripeSubscriptionRepository>;
  let stripeInvoiceService: jest.Mocked<StripeInvoiceService>;
  let jsonApiService: jest.Mocked<JsonApiService>;

  // Test data constants
  const MOCK_BILLING_CUSTOMER: BillingCustomer = {
    id: "billing_customer_123",
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

  const MOCK_DB_SUBSCRIPTION: StripeSubscription = {
    id: "subscription_db_123",
    stripeSubscriptionId: TEST_IDS.subscriptionId,
    stripeSubscriptionItemId: "si_test_123",
    status: "active",
    currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2025-02-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    quantity: 1,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    billingCustomer: MOCK_BILLING_CUSTOMER,
    price: {} as any,
  };

  const MOCK_DB_INVOICE: Invoice = {
    id: "invoice_db_123",
    stripeInvoiceId: TEST_IDS.invoiceId,
    stripeInvoiceNumber: "INV-001",
    stripeHostedInvoiceUrl: "https://invoice.stripe.com/i/test",
    stripePdfUrl: "https://invoice.stripe.com/i/test.pdf",
    status: "open",
    currency: "usd",
    amountDue: 999,
    amountPaid: 0,
    amountRemaining: 999,
    subtotal: 999,
    total: 999,
    tax: null,
    periodStart: new Date("2025-01-01T00:00:00Z"),
    periodEnd: new Date("2025-02-01T00:00:00Z"),
    dueDate: new Date("2025-01-15T00:00:00Z"),
    paidAt: null,
    attemptCount: 0,
    attempted: false,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    billingCustomer: MOCK_BILLING_CUSTOMER,
    subscription: MOCK_DB_SUBSCRIPTION,
  };

  const MOCK_JSON_API_RESPONSE = {
    data: {
      type: "invoices",
      id: MOCK_DB_INVOICE.id,
      attributes: {
        status: MOCK_DB_INVOICE.status,
        amountDue: MOCK_DB_INVOICE.amountDue,
        total: MOCK_DB_INVOICE.total,
      },
    },
  };

  const MOCK_JSON_API_LIST_RESPONSE = {
    data: [MOCK_JSON_API_RESPONSE.data],
    meta: {
      page: {
        current: 1,
        total: 1,
      },
    },
  };

  beforeEach(async () => {
    const mockInvoiceRepository = {
      findById: jest.fn(),
      findByBillingCustomerId: jest.fn(),
      findByStripeInvoiceId: jest.fn(),
      create: jest.fn(),
      updateByStripeInvoiceId: jest.fn(),
    };

    const mockBillingCustomerRepository = {
      findByCompanyId: jest.fn(),
      findByStripeCustomerId: jest.fn(),
    };

    const mockStripeSubscriptionRepository = {
      findById: jest.fn(),
      findByStripeSubscriptionId: jest.fn(),
    };

    const mockStripeInvoiceService = {
      getInvoice: jest.fn(),
      getUpcomingInvoice: jest.fn(),
    };

    const mockJsonApiService = {
      buildSingle: jest.fn(),
      buildList: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceService,
        {
          provide: InvoiceRepository,
          useValue: mockInvoiceRepository,
        },
        {
          provide: BillingCustomerRepository,
          useValue: mockBillingCustomerRepository,
        },
        {
          provide: StripeSubscriptionRepository,
          useValue: mockStripeSubscriptionRepository,
        },
        {
          provide: StripeInvoiceService,
          useValue: mockStripeInvoiceService,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
      ],
    }).compile();

    service = module.get<InvoiceService>(InvoiceService);
    invoiceRepository = module.get(InvoiceRepository);
    billingCustomerRepository = module.get(BillingCustomerRepository);
    subscriptionRepository = module.get(StripeSubscriptionRepository);
    stripeInvoiceService = module.get(StripeInvoiceService);
    jsonApiService = module.get(JsonApiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("listInvoices", () => {
    const validParams = {
      companyId: TEST_IDS.companyId,
      query: { page: { number: 1, size: 10 } },
    };

    it("should return paginated invoices list", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByBillingCustomerId.mockResolvedValue([MOCK_DB_INVOICE]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      const result = await service.listInvoices(validParams);

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validParams.companyId,
      });
      expect(invoiceRepository.findByBillingCustomerId).toHaveBeenCalledWith({
        billingCustomerId: MOCK_BILLING_CUSTOMER.id,
        status: undefined,
      });
      expect(jsonApiService.buildList).toHaveBeenCalledWith(expect.any(Object), [MOCK_DB_INVOICE], expect.any(Object));
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listInvoices(validParams)).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(invoiceRepository.findByBillingCustomerId).not.toHaveBeenCalled();
      expect(jsonApiService.buildList).not.toHaveBeenCalled();
    });

    it("should filter by status when provided", async () => {
      const paramsWithStatus = { ...validParams, status: "paid" as InvoiceStatus };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByBillingCustomerId.mockResolvedValue([MOCK_DB_INVOICE]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      await service.listInvoices(paramsWithStatus);

      expect(invoiceRepository.findByBillingCustomerId).toHaveBeenCalledWith({
        billingCustomerId: MOCK_BILLING_CUSTOMER.id,
        status: "paid",
      });
    });

    it("should use JsonApiPaginator with query params", async () => {
      const customQuery = { page: { number: 2, size: 20 } };
      const paramsWithCustomQuery = { ...validParams, query: customQuery };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByBillingCustomerId.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [], meta: {} });

      await service.listInvoices(paramsWithCustomQuery);

      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.any(Object),
        [],
        expect.any(Object), // JsonApiPaginator instance
      );
    });

    it("should return empty list when no invoices exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByBillingCustomerId.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [], meta: {} });

      const result = await service.listInvoices(validParams);

      expect(result).toEqual({ data: [], meta: {} });
    });
  });

  describe("getInvoice", () => {
    const validParams = {
      id: MOCK_DB_INVOICE.id,
      companyId: TEST_IDS.companyId,
    };

    it("should return invoice when found and ownership verified", async () => {
      invoiceRepository.findById.mockResolvedValue(MOCK_DB_INVOICE);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.getInvoice(validParams);

      expect(invoiceRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validParams.companyId,
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_DB_INVOICE);
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when invoice does not exist", async () => {
      invoiceRepository.findById.mockResolvedValue(null);

      await expect(service.getInvoice(validParams)).rejects.toThrow(
        new HttpException("Invoice not found", HttpStatus.NOT_FOUND),
      );

      expect(billingCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when customer does not exist", async () => {
      invoiceRepository.findById.mockResolvedValue(MOCK_DB_INVOICE);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getInvoice(validParams)).rejects.toThrow(
        new HttpException("Invoice does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when invoice does not belong to company", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      invoiceRepository.findById.mockResolvedValue(MOCK_DB_INVOICE);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.getInvoice(validParams)).rejects.toThrow(
        new HttpException("Invoice does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN with correct status code", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      invoiceRepository.findById.mockResolvedValue(MOCK_DB_INVOICE);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      try {
        await service.getInvoice(validParams);
        fail("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect((error as HttpException).message).toBe("Invoice does not belong to this company");
      }
    });
  });

  describe("getUpcomingInvoice", () => {
    const validParams = {
      companyId: TEST_IDS.companyId,
    };

    const mockUpcomingInvoice: Stripe.UpcomingInvoice = {
      ...MOCK_INVOICE,
      subtotal: 999,
      total: 1099,
      amount_due: 1099,
      currency: "usd",
      period_start: 1704067200, // Unix timestamp: 2024-01-01 00:00:00
      period_end: 1706745600, // Unix timestamp: 2024-02-01 00:00:00
      lines: {
        object: "list",
        data: [
          {
            id: "il_test_1",
            object: "line_item",
            amount: 999,
            currency: "usd",
            description: "Monthly Plan",
            period: {
              start: 1704067200,
              end: 1706745600,
            },
            quantity: 1,
          } as any,
        ],
        has_more: false,
        url: "/v1/invoices/upcoming/lines",
      },
    };

    it("should return upcoming invoice without subscriptionId", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeInvoiceService.getUpcomingInvoice.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.getUpcomingInvoice(validParams);

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validParams.companyId,
      });
      expect(stripeInvoiceService.getUpcomingInvoice).toHaveBeenCalledWith({
        customerId: MOCK_BILLING_CUSTOMER.stripeCustomerId,
        subscriptionId: undefined,
      });
      expect(result).toEqual({
        subtotal: 999,
        total: 1099,
        amountDue: 1099,
        currency: "usd",
        periodStart: new Date(1704067200 * 1000).toISOString(),
        periodEnd: new Date(1706745600 * 1000).toISOString(),
        lines: [
          {
            id: "il_test_1",
            description: "Monthly Plan",
            amount: 999,
            currency: "usd",
            quantity: 1,
            periodStart: new Date(1704067200 * 1000).toISOString(),
            periodEnd: new Date(1706745600 * 1000).toISOString(),
          },
        ],
      });
    });

    it("should return upcoming invoice with subscriptionId parameter", async () => {
      const paramsWithStripeSubscription = { ...validParams, subscriptionId: MOCK_DB_SUBSCRIPTION.id };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeInvoiceService.getUpcomingInvoice.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.getUpcomingInvoice(paramsWithStripeSubscription);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({
        id: MOCK_DB_SUBSCRIPTION.id,
      });
      expect(stripeInvoiceService.getUpcomingInvoice).toHaveBeenCalledWith({
        customerId: MOCK_BILLING_CUSTOMER.stripeCustomerId,
        subscriptionId: MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
      });
      expect(result.lines).toHaveLength(1);
    });

    it("should throw NOT_FOUND when customer not found", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getUpcomingInvoice(validParams)).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripeInvoiceService.getUpcomingInvoice).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when subscription not found", async () => {
      const paramsWithStripeSubscription = { ...validParams, subscriptionId: "non_existent_sub" };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.getUpcomingInvoice(paramsWithStripeSubscription)).rejects.toThrow(
        new HttpException("Subscription not found or does not belong to this company", HttpStatus.NOT_FOUND),
      );

      expect(stripeInvoiceService.getUpcomingInvoice).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when subscription does not belong to company", async () => {
      const paramsWithStripeSubscription = { ...validParams, subscriptionId: MOCK_DB_SUBSCRIPTION.id };
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);

      await expect(service.getUpcomingInvoice(paramsWithStripeSubscription)).rejects.toThrow(
        new HttpException("Subscription not found or does not belong to this company", HttpStatus.NOT_FOUND),
      );

      expect(stripeInvoiceService.getUpcomingInvoice).not.toHaveBeenCalled();
    });

    it("should convert Unix timestamps to ISO strings (multiply by 1000)", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeInvoiceService.getUpcomingInvoice.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.getUpcomingInvoice(validParams);

      expect(result.periodStart).toBe(new Date(1704067200 * 1000).toISOString());
      expect(result.periodEnd).toBe(new Date(1706745600 * 1000).toISOString());
      expect(result.lines[0].periodStart).toBe(new Date(1704067200 * 1000).toISOString());
      expect(result.lines[0].periodEnd).toBe(new Date(1706745600 * 1000).toISOString());
    });

    it("should handle null period_start and period_end", async () => {
      const invoiceWithNullPeriods = {
        ...mockUpcomingInvoice,
        period_start: null,
        period_end: null,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeInvoiceService.getUpcomingInvoice.mockResolvedValue(invoiceWithNullPeriods as any);

      const result = await service.getUpcomingInvoice(validParams);

      expect(result.periodStart).toBeNull();
      expect(result.periodEnd).toBeNull();
    });

    it("should map line items with all required fields", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeInvoiceService.getUpcomingInvoice.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.getUpcomingInvoice(validParams);

      expect(result.lines[0]).toEqual({
        id: "il_test_1",
        description: "Monthly Plan",
        amount: 999,
        currency: "usd",
        quantity: 1,
        periodStart: new Date(1704067200 * 1000).toISOString(),
        periodEnd: new Date(1706745600 * 1000).toISOString(),
      });
    });
  });

  describe("syncInvoiceFromStripe", () => {
    const validParams = {
      stripeInvoiceId: TEST_IDS.invoiceId,
    };

    const mockStripeInvoice: Stripe.Invoice = {
      ...MOCK_INVOICE,
      id: TEST_IDS.invoiceId,
      customer: TEST_IDS.customerId,
      number: "INV-001",
      hosted_invoice_url: "https://invoice.stripe.com/i/test",
      invoice_pdf: "https://invoice.stripe.com/i/test.pdf",
      status: "open",
      currency: "usd",
      amount_due: 999,
      amount_paid: 0,
      amount_remaining: 999,
      subtotal: 999,
      total: 1099,
      total_excluding_tax: 999,
      period_start: 1704067200, // Unix timestamp
      period_end: 1706745600, // Unix timestamp
      due_date: 1705276800, // 2024-01-15
      status_transitions: {
        finalized_at: null,
        marked_uncollectible_at: null,
        paid_at: null,
        voided_at: null,
      },
      attempt_count: 1,
      attempted: true,
      parent: null,
    };

    it("should early return if no stripeCustomerId", async () => {
      const invoiceWithoutCustomer = { ...mockStripeInvoice, customer: null };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithoutCustomer as any);

      await service.syncInvoiceFromStripe(validParams);

      expect(stripeInvoiceService.getInvoice).toHaveBeenCalledWith(TEST_IDS.invoiceId);
      expect(billingCustomerRepository.findByStripeCustomerId).not.toHaveBeenCalled();
      expect(invoiceRepository.create).not.toHaveBeenCalled();
      expect(invoiceRepository.updateByStripeInvoiceId).not.toHaveBeenCalled();
    });

    it("should early return if customer not found in database", async () => {
      stripeInvoiceService.getInvoice.mockResolvedValue(mockStripeInvoice);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

      await service.syncInvoiceFromStripe(validParams);

      expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(invoiceRepository.create).not.toHaveBeenCalled();
      expect(invoiceRepository.updateByStripeInvoiceId).not.toHaveBeenCalled();
    });

    it("should handle customer as string", async () => {
      const invoiceWithStringCustomer = {
        ...mockStripeInvoice,
        customer: TEST_IDS.customerId, // string
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithStringCustomer);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_DB_INVOICE);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
    });

    it("should handle customer as object (typeof check)", async () => {
      const invoiceWithObjectCustomer = {
        ...mockStripeInvoice,
        customer: { id: TEST_IDS.customerId } as Stripe.Customer, // object
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithObjectCustomer);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_DB_INVOICE);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
    });

    it("should update existing invoice if found", async () => {
      stripeInvoiceService.getInvoice.mockResolvedValue(mockStripeInvoice);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_DB_INVOICE);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: TEST_IDS.invoiceId,
      });
      expect(invoiceRepository.updateByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: TEST_IDS.invoiceId,
        status: "open",
        amountDue: 999,
        amountPaid: 0,
        amountRemaining: 999,
        paidAt: null,
        attemptCount: 1,
        attempted: true,
        stripeHostedInvoiceUrl: "https://invoice.stripe.com/i/test",
        stripePdfUrl: "https://invoice.stripe.com/i/test.pdf",
      });
      expect(invoiceRepository.create).not.toHaveBeenCalled();
    });

    it("should create new invoice if not found", async () => {
      stripeInvoiceService.getInvoice.mockResolvedValue(mockStripeInvoice);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith({
        billingCustomerId: MOCK_BILLING_CUSTOMER.id,
        subscriptionId: undefined,
        stripeInvoiceId: TEST_IDS.invoiceId,
        stripeInvoiceNumber: "INV-001",
        stripeHostedInvoiceUrl: "https://invoice.stripe.com/i/test",
        stripePdfUrl: "https://invoice.stripe.com/i/test.pdf",
        status: "open",
        currency: "usd",
        amountDue: 999,
        amountPaid: 0,
        amountRemaining: 999,
        subtotal: 999,
        total: 1099,
        tax: 100, // total - total_excluding_tax
        periodStart: new Date(1704067200 * 1000),
        periodEnd: new Date(1706745600 * 1000),
        dueDate: new Date(1705276800 * 1000),
        paidAt: null,
        attemptCount: 1,
        attempted: true,
      });
      expect(invoiceRepository.updateByStripeInvoiceId).not.toHaveBeenCalled();
    });

    it("should calculate tax as total - total_excluding_tax", async () => {
      stripeInvoiceService.getInvoice.mockResolvedValue(mockStripeInvoice);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tax: 100, // 1099 - 999
        }),
      );
    });

    it("should handle null total_excluding_tax in tax calculation", async () => {
      const invoiceWithNullTax = {
        ...mockStripeInvoice,
        total_excluding_tax: null,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithNullTax as any);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tax: null,
        }),
      );
    });

    it("should convert Unix timestamps to Date objects (multiply by 1000)", async () => {
      stripeInvoiceService.getInvoice.mockResolvedValue(mockStripeInvoice);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          periodStart: new Date(1704067200 * 1000),
          periodEnd: new Date(1706745600 * 1000),
          dueDate: new Date(1705276800 * 1000),
        }),
      );
    });

    it("should handle null paidAt when status_transitions.paid_at does not exist", async () => {
      const invoiceWithoutPaidAt = {
        ...mockStripeInvoice,
        status_transitions: {
          finalized_at: null,
          marked_uncollectible_at: null,
          paid_at: null,
          voided_at: null,
        },
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithoutPaidAt);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paidAt: null,
        }),
      );
    });

    it("should convert paidAt Unix timestamp when present", async () => {
      const invoiceWithPaidAt = {
        ...mockStripeInvoice,
        status_transitions: {
          finalized_at: null,
          marked_uncollectible_at: null,
          paid_at: 1704153600, // Unix timestamp
          voided_at: null,
        },
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithPaidAt);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paidAt: new Date(1704153600 * 1000),
        }),
      );
    });

    it("should handle null dueDate", async () => {
      const invoiceWithoutDueDate = {
        ...mockStripeInvoice,
        due_date: null,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithoutDueDate);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dueDate: null,
        }),
      );
    });

    it("should default attemptCount to 0 when null", async () => {
      const invoiceWithNullAttemptCount = {
        ...mockStripeInvoice,
        attempt_count: null,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithNullAttemptCount as any);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptCount: 0,
        }),
      );
    });

    it("should default attempted to false when null", async () => {
      const invoiceWithNullAttempted = {
        ...mockStripeInvoice,
        attempted: null,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithNullAttempted as any);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          attempted: false,
        }),
      );
    });

    it("should handle subscription from parent.subscription_details as string", async () => {
      const invoiceWithStripeSubscription = {
        ...mockStripeInvoice,
        parent: {
          subscription_details: {
            subscription: TEST_IDS.subscriptionId, // string
          },
        } as any,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithStripeSubscription);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(subscriptionRepository.findByStripeSubscriptionId).toHaveBeenCalledWith({
        stripeSubscriptionId: TEST_IDS.subscriptionId,
      });
      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: MOCK_DB_SUBSCRIPTION.id,
        }),
      );
    });

    it("should handle subscription_details.subscription as object", async () => {
      const invoiceWithStripeSubscription = {
        ...mockStripeInvoice,
        parent: {
          subscription_details: {
            subscription: { id: TEST_IDS.subscriptionId } as any, // object
          },
        } as any,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithStripeSubscription);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(subscriptionRepository.findByStripeSubscriptionId).toHaveBeenCalledWith({
        stripeSubscriptionId: TEST_IDS.subscriptionId,
      });
      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: MOCK_DB_SUBSCRIPTION.id,
        }),
      );
    });

    it("should handle missing subscription (no parent.subscription_details)", async () => {
      const invoiceWithoutStripeSubscription = {
        ...mockStripeInvoice,
        parent: null,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithoutStripeSubscription);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(subscriptionRepository.findByStripeSubscriptionId).not.toHaveBeenCalled();
      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: undefined,
        }),
      );
    });

    it("should handle subscription not found in database", async () => {
      const invoiceWithStripeSubscription = {
        ...mockStripeInvoice,
        parent: {
          subscription_details: {
            subscription: TEST_IDS.subscriptionId,
          },
        } as any,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithStripeSubscription);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(null);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      invoiceRepository.create.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: undefined,
        }),
      );
    });

    it("should update existing invoice with all fields", async () => {
      const invoiceWithPaidAt = {
        ...mockStripeInvoice,
        status_transitions: {
          finalized_at: null,
          marked_uncollectible_at: null,
          paid_at: 1704153600,
          voided_at: null,
        },
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithPaidAt);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_DB_INVOICE);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.updateByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: TEST_IDS.invoiceId,
        status: "open",
        amountDue: 999,
        amountPaid: 0,
        amountRemaining: 999,
        paidAt: new Date(1704153600 * 1000),
        attemptCount: 1,
        attempted: true,
        stripeHostedInvoiceUrl: "https://invoice.stripe.com/i/test",
        stripePdfUrl: "https://invoice.stripe.com/i/test.pdf",
      });
    });

    it("should handle undefined URLs in update", async () => {
      const invoiceWithoutUrls = {
        ...mockStripeInvoice,
        hosted_invoice_url: null,
        invoice_pdf: null,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(invoiceWithoutUrls);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_DB_INVOICE);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe(validParams);

      expect(invoiceRepository.updateByStripeInvoiceId).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeHostedInvoiceUrl: undefined,
          stripePdfUrl: undefined,
        }),
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle concurrent requests for same invoice", async () => {
      const validParams = { id: MOCK_DB_INVOICE.id, companyId: TEST_IDS.companyId };
      invoiceRepository.findById.mockResolvedValue(MOCK_DB_INVOICE);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const promises = [
        service.getInvoice(validParams),
        service.getInvoice(validParams),
        service.getInvoice(validParams),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(invoiceRepository.findById).toHaveBeenCalledTimes(3);
    });

    it("should handle empty string company ID gracefully", async () => {
      const params = { companyId: "", query: {} };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listInvoices(params)).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );
    });

    it("should preserve exact Stripe IDs in all operations", async () => {
      const exactStripeId = "in_exact_test_123456";
      const invoice = { ...MOCK_DB_INVOICE, stripeInvoiceId: exactStripeId };
      const mockStripeInvoice: Stripe.Invoice = {
        ...MOCK_INVOICE,
        id: exactStripeId,
        customer: TEST_IDS.customerId,
      };

      stripeInvoiceService.getInvoice.mockResolvedValue(mockStripeInvoice);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(invoice);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue(undefined);

      await service.syncInvoiceFromStripe({ stripeInvoiceId: exactStripeId });

      expect(invoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: exactStripeId,
      });
    });

    it("should handle Stripe API errors gracefully", async () => {
      const stripeError = new Error("Stripe API error");
      stripeInvoiceService.getInvoice.mockRejectedValue(stripeError);

      await expect(service.syncInvoiceFromStripe({ stripeInvoiceId: TEST_IDS.invoiceId })).rejects.toThrow(
        "Stripe API error",
      );

      expect(invoiceRepository.create).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      const mockStripeInvoice: Stripe.Invoice = {
        ...MOCK_INVOICE,
        customer: TEST_IDS.customerId,
      };
      stripeInvoiceService.getInvoice.mockResolvedValue(mockStripeInvoice);
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      const dbError = new Error("Database error");
      invoiceRepository.create.mockRejectedValue(dbError);

      await expect(service.syncInvoiceFromStripe({ stripeInvoiceId: TEST_IDS.invoiceId })).rejects.toThrow(
        "Database error",
      );

      expect(stripeInvoiceService.getInvoice).toHaveBeenCalled();
    });
  });
});
