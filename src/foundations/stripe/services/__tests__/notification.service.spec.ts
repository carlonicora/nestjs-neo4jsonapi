// Set environment variable BEFORE any imports
process.env.QUEUE = "test";

// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide the imports that the service needs
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = jest.requireActual("@carlonicora/nestjs-neo4jsonapi");

  // Create a mock AppLoggingService class
  class AppLoggingService {
    log = jest.fn();
    error = jest.fn();
    warn = jest.fn();
    debug = jest.fn();
    verbose = jest.fn();
  }

  return {
    ...actual,
    AppLoggingService,
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
import { getQueueToken } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { NotificationService, PaymentFailureNotificationParams } from "../notification.service";
import { BillingCustomerRepository } from "../../repositories/billing-customer.repository";
import { StripeInvoiceRepository } from "../../../stripe-invoice/repositories/stripe-invoice.repository";
import { AppLoggingService } from "../../../../core/logging";
import { BillingCustomer } from "../../entities/billing-customer.entity";
import { StripeInvoice } from "../../../stripe-invoice/entities/stripe-invoice.entity";

describe("NotificationService", () => {
  let service: NotificationService;
  let emailQueue: jest.Mocked<Queue>;
  let billingCustomerRepository: jest.Mocked<BillingCustomerRepository>;
  let stripeInvoiceRepository: jest.Mocked<StripeInvoiceRepository>;
  let logger: jest.Mocked<AppLoggingService>;

  // Test data constants
  const TEST_IDS = {
    stripeCustomerId: "cus_test123",
    stripeInvoiceId: "in_test456",
    stripePaymentIntentId: "pi_test789",
    subscriptionId: "sub_test101",
  };

  const MOCK_BILLING_CUSTOMER: BillingCustomer = {
    id: "billing_customer_123",
    stripeCustomerId: TEST_IDS.stripeCustomerId,
    email: "test@example.com",
    name: "Test Customer",
    currency: "usd",
    balance: 0,
    delinquent: false,
    defaultPaymentMethodId: "pm_test",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    company: {} as any,
  };

  const MOCK_BILLING_CUSTOMER_NO_NAME: BillingCustomer = {
    ...MOCK_BILLING_CUSTOMER,
    name: null,
  };

  const MOCK_INVOICE: StripeInvoice = {
    id: "invoice_123",
    stripeInvoiceId: TEST_IDS.stripeInvoiceId,
    stripeInvoiceNumber: "INV-2025-001",
    stripeHostedInvoiceUrl: "https://stripe.com/invoices/test123",
    stripePdfUrl: "https://stripe.com/invoices/test123.pdf",
    status: "open",
    currency: "usd",
    amountDue: 5000,
    amountPaid: 0,
    amountRemaining: 5000,
    subtotal: 5000,
    total: 5000,
    tax: 0,
    periodStart: new Date("2025-01-01T00:00:00Z"),
    periodEnd: new Date("2025-02-01T00:00:00Z"),
    dueDate: new Date("2025-02-05T00:00:00Z"),
    paidAt: null,
    attemptCount: 1,
    attempted: true,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    billingCustomer: {} as any,
  };

  beforeEach(async () => {
    const mockEmailQueue = {
      add: jest.fn(),
    };

    const mockBillingCustomerRepository = {
      findByStripeCustomerId: jest.fn(),
    };

    const mockStripeInvoiceRepository = {
      findByStripeInvoiceId: jest.fn(),
    };

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getQueueToken("email"),
          useValue: mockEmailQueue,
        },
        {
          provide: BillingCustomerRepository,
          useValue: mockBillingCustomerRepository,
        },
        {
          provide: StripeInvoiceRepository,
          useValue: mockStripeInvoiceRepository,
        },
        {
          provide: AppLoggingService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    emailQueue = module.get(getQueueToken("email"));
    billingCustomerRepository = module.get(BillingCustomerRepository);
    stripeInvoiceRepository = module.get(StripeInvoiceRepository);
    logger = module.get(AppLoggingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("sendPaymentFailedEmail", () => {
    const baseParams: PaymentFailureNotificationParams = {
      stripeCustomerId: TEST_IDS.stripeCustomerId,
      stripeInvoiceId: TEST_IDS.stripeInvoiceId,
      stripePaymentIntentId: TEST_IDS.stripePaymentIntentId,
      errorMessage: "Card declined",
      amount: 5000,
      currency: "usd",
    };

    describe("Happy Path", () => {
      it("should queue payment failure email with all parameters", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.stripeCustomerId,
        });
        expect(stripeInvoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
          stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        });
        expect(emailQueue.add).toHaveBeenCalledWith(
          "billing-notification",
          {
            jobType: "payment-failure",
            payload: {
              to: MOCK_BILLING_CUSTOMER.email,
              customerName: MOCK_BILLING_CUSTOMER.name,
              stripeCustomerId: TEST_IDS.stripeCustomerId,
              stripeInvoiceId: TEST_IDS.stripeInvoiceId,
              stripePaymentIntentId: TEST_IDS.stripePaymentIntentId,
              errorMessage: "Card declined",
              amount: 5000,
              currency: "usd",
              invoiceUrl: MOCK_INVOICE.stripeHostedInvoiceUrl,
              invoiceNumber: MOCK_INVOICE.stripeInvoiceNumber,
              locale: "en",
            },
          },
          {
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
          },
        );
        expect(logger.log).toHaveBeenCalledWith(
          `Queued payment failure notification for customer ${TEST_IDS.stripeCustomerId} (invoice: ${TEST_IDS.stripeInvoiceId})`,
        );
      });

      it("should queue payment failure email without invoice details when stripeInvoiceId not provided", async () => {
        const paramsWithoutInvoice: PaymentFailureNotificationParams = {
          stripeCustomerId: TEST_IDS.stripeCustomerId,
          stripePaymentIntentId: TEST_IDS.stripePaymentIntentId,
          errorMessage: "Card declined",
          amount: 5000,
          currency: "usd",
        };

        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(paramsWithoutInvoice);

        expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.stripeCustomerId,
        });
        expect(stripeInvoiceRepository.findByStripeInvoiceId).not.toHaveBeenCalled();
        expect(emailQueue.add).toHaveBeenCalledWith(
          "billing-notification",
          {
            jobType: "payment-failure",
            payload: {
              to: MOCK_BILLING_CUSTOMER.email,
              customerName: MOCK_BILLING_CUSTOMER.name,
              stripeCustomerId: TEST_IDS.stripeCustomerId,
              stripeInvoiceId: undefined,
              stripePaymentIntentId: TEST_IDS.stripePaymentIntentId,
              errorMessage: "Card declined",
              amount: 5000,
              currency: "usd",
              invoiceUrl: undefined,
              invoiceNumber: undefined,
              locale: "en",
            },
          },
          {
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
          },
        );
        expect(logger.log).toHaveBeenCalledWith(
          `Queued payment failure notification for customer ${TEST_IDS.stripeCustomerId}`,
        );
      });

      it("should fetch invoice details when stripeInvoiceId is provided", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        expect(stripeInvoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
          stripeInvoiceId: TEST_IDS.stripeInvoiceId,
        });
      });

      it("should not fetch invoice when stripeInvoiceId is not provided", async () => {
        const paramsWithoutInvoice: PaymentFailureNotificationParams = {
          stripeCustomerId: TEST_IDS.stripeCustomerId,
        };

        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(paramsWithoutInvoice);

        expect(stripeInvoiceRepository.findByStripeInvoiceId).not.toHaveBeenCalled();
      });

      it("should include invoice URL and number from invoice details", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.invoiceUrl).toBe(MOCK_INVOICE.stripeHostedInvoiceUrl);
        expect(addCall[1].payload.invoiceNumber).toBe(MOCK_INVOICE.stripeInvoiceNumber);
      });
    });

    describe("Default Values", () => {
      it("should use default errorMessage when not provided", async () => {
        const paramsWithoutError: PaymentFailureNotificationParams = {
          stripeCustomerId: TEST_IDS.stripeCustomerId,
        };

        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(paramsWithoutError);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.errorMessage).toBe("Payment failed");
      });

      it("should use default currency when not provided", async () => {
        const paramsWithoutCurrency: PaymentFailureNotificationParams = {
          stripeCustomerId: TEST_IDS.stripeCustomerId,
        };

        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(paramsWithoutCurrency);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.currency).toBe("usd");
      });

      it("should use 'Customer' as default customerName when name is null", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER_NO_NAME);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.customerName).toBe("Customer");
      });

      it("should preserve custom errorMessage when provided", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail({
          ...baseParams,
          errorMessage: "Insufficient funds",
        });

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.errorMessage).toBe("Insufficient funds");
      });

      it("should preserve custom currency when provided", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail({
          ...baseParams,
          currency: "eur",
        });

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.currency).toBe("eur");
      });
    });

    describe("Early Returns - Customer Not Found", () => {
      it("should return early and log warning when customer not found", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

        await service.sendPaymentFailedEmail(baseParams);

        expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.stripeCustomerId,
        });
        expect(logger.warn).toHaveBeenCalledWith(
          `Cannot send payment failure notification: Customer ${TEST_IDS.stripeCustomerId} not found in Neo4j`,
        );
        expect(stripeInvoiceRepository.findByStripeInvoiceId).not.toHaveBeenCalled();
        expect(emailQueue.add).not.toHaveBeenCalled();
        expect(logger.log).not.toHaveBeenCalled();
      });

      it("should not throw when customer not found", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

        await expect(service.sendPaymentFailedEmail(baseParams)).resolves.toBeUndefined();
      });
    });

    describe("BullMQ Job Configuration", () => {
      it("should use correct job name", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        expect(emailQueue.add).toHaveBeenCalledWith("billing-notification", expect.any(Object), expect.any(Object));
      });

      it("should use correct jobType", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].jobType).toBe("payment-failure");
      });

      it("should configure retry attempts to 3", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[2].attempts).toBe(3);
      });

      it("should configure exponential backoff with 5000ms delay", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[2].backoff).toEqual({
          type: "exponential",
          delay: 5000,
        });
      });
    });

    describe("Payload Structure", () => {
      it("should include all required payload fields", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        const payload = addCall[1].payload;

        expect(payload).toHaveProperty("to");
        expect(payload).toHaveProperty("customerName");
        expect(payload).toHaveProperty("stripeCustomerId");
        expect(payload).toHaveProperty("stripeInvoiceId");
        expect(payload).toHaveProperty("stripePaymentIntentId");
        expect(payload).toHaveProperty("errorMessage");
        expect(payload).toHaveProperty("amount");
        expect(payload).toHaveProperty("currency");
        expect(payload).toHaveProperty("invoiceUrl");
        expect(payload).toHaveProperty("invoiceNumber");
        expect(payload).toHaveProperty("locale");
      });

      it("should set locale to 'en'", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.locale).toBe("en");
      });

      it("should use customer email as 'to' field", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.to).toBe(MOCK_BILLING_CUSTOMER.email);
      });
    });

    describe("Error Handling", () => {
      it("should catch and log errors from repository without throwing", async () => {
        const error = new Error("Database connection failed");
        billingCustomerRepository.findByStripeCustomerId.mockRejectedValue(error);

        await expect(service.sendPaymentFailedEmail(baseParams)).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to queue payment failure notification for ${TEST_IDS.stripeCustomerId}: Database connection failed`,
        );
        expect(emailQueue.add).not.toHaveBeenCalled();
      });

      it("should catch and log errors from queue without throwing", async () => {
        const error = new Error("Queue is full");
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockRejectedValue(error);

        await expect(service.sendPaymentFailedEmail(baseParams)).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to queue payment failure notification for ${TEST_IDS.stripeCustomerId}: Queue is full`,
        );
      });

      it("should handle unknown error types", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockRejectedValue("String error");

        await expect(service.sendPaymentFailedEmail(baseParams)).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to queue payment failure notification for ${TEST_IDS.stripeCustomerId}: Unknown error`,
        );
      });

      it("should not throw errors to prevent blocking webhook processing", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockRejectedValue(new Error("Critical error"));

        await expect(service.sendPaymentFailedEmail(baseParams)).resolves.toBeUndefined();
      });
    });

    describe("Logging", () => {
      it("should log success message with invoice ID when invoice provided", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        expect(logger.log).toHaveBeenCalledWith(
          `Queued payment failure notification for customer ${TEST_IDS.stripeCustomerId} (invoice: ${TEST_IDS.stripeInvoiceId})`,
        );
      });

      it("should log success message without invoice ID when invoice not provided", async () => {
        const paramsWithoutInvoice: PaymentFailureNotificationParams = {
          stripeCustomerId: TEST_IDS.stripeCustomerId,
        };

        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(paramsWithoutInvoice);

        expect(logger.log).toHaveBeenCalledWith(
          `Queued payment failure notification for customer ${TEST_IDS.stripeCustomerId}`,
        );
      });
    });

    describe("Edge Cases", () => {
      it("should handle invoice not found gracefully", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(baseParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.invoiceUrl).toBeUndefined();
        expect(addCall[1].payload.invoiceNumber).toBeUndefined();
      });

      it("should handle zero amount", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail({
          ...baseParams,
          amount: 0,
        });

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.amount).toBe(0);
      });

      it("should handle large amount values", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail({
          ...baseParams,
          amount: 999999999,
        });

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.amount).toBe(999999999);
      });

      it("should use default errorMessage when empty string provided", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail({
          ...baseParams,
          errorMessage: "",
        });

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.errorMessage).toBe("Payment failed");
      });

      it("should preserve exact parameter values", async () => {
        const exactParams: PaymentFailureNotificationParams = {
          stripeCustomerId: "cus_exact_123",
          stripeInvoiceId: "in_exact_456",
          stripePaymentIntentId: "pi_exact_789",
          errorMessage: "Exact error message",
          amount: 12345,
          currency: "gbp",
        };

        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendPaymentFailedEmail(exactParams);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.stripeCustomerId).toBe("cus_exact_123");
        expect(addCall[1].payload.stripeInvoiceId).toBe("in_exact_456");
        expect(addCall[1].payload.stripePaymentIntentId).toBe("pi_exact_789");
        expect(addCall[1].payload.errorMessage).toBe("Exact error message");
        expect(addCall[1].payload.amount).toBe(12345);
        expect(addCall[1].payload.currency).toBe("gbp");
      });
    });
  });

  describe("sendSubscriptionStatusChangeEmail", () => {
    const stripeCustomerId = TEST_IDS.stripeCustomerId;
    const subscriptionId = TEST_IDS.subscriptionId;
    const status = "active";

    describe("Happy Path", () => {
      it("should queue subscription status change email with all parameters", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId,
        });
        expect(emailQueue.add).toHaveBeenCalledWith(
          "billing-notification",
          {
            jobType: "subscription-status-change",
            payload: {
              to: MOCK_BILLING_CUSTOMER.email,
              customerName: MOCK_BILLING_CUSTOMER.name,
              stripeCustomerId,
              subscriptionId,
              status,
              locale: "en",
            },
          },
          {
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
          },
        );
        expect(logger.log).toHaveBeenCalledWith(
          `Queued subscription status change notification for customer ${stripeCustomerId}`,
        );
      });

      it("should use 'Customer' as default customerName when name is null", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER_NO_NAME);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.customerName).toBe("Customer");
      });

      it("should preserve customer name when provided", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.customerName).toBe(MOCK_BILLING_CUSTOMER.name);
      });
    });

    describe("Early Returns - Customer Not Found", () => {
      it("should return early and log warning when customer not found", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId,
        });
        expect(logger.warn).toHaveBeenCalledWith(
          `Cannot send subscription notification: Customer ${stripeCustomerId} not found in Neo4j`,
        );
        expect(emailQueue.add).not.toHaveBeenCalled();
        expect(logger.log).not.toHaveBeenCalled();
      });

      it("should not throw when customer not found", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

        await expect(
          service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId),
        ).resolves.toBeUndefined();
      });
    });

    describe("BullMQ Job Configuration", () => {
      it("should use correct job name", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        expect(emailQueue.add).toHaveBeenCalledWith("billing-notification", expect.any(Object), expect.any(Object));
      });

      it("should use correct jobType", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].jobType).toBe("subscription-status-change");
      });

      it("should configure retry attempts to 3", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[2].attempts).toBe(3);
      });

      it("should configure exponential backoff with 5000ms delay", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[2].backoff).toEqual({
          type: "exponential",
          delay: 5000,
        });
      });
    });

    describe("Payload Structure", () => {
      it("should include all required payload fields", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        const payload = addCall[1].payload;

        expect(payload).toHaveProperty("to");
        expect(payload).toHaveProperty("customerName");
        expect(payload).toHaveProperty("stripeCustomerId");
        expect(payload).toHaveProperty("subscriptionId");
        expect(payload).toHaveProperty("status");
        expect(payload).toHaveProperty("locale");
      });

      it("should set locale to 'en'", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.locale).toBe("en");
      });

      it("should use customer email as 'to' field", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.to).toBe(MOCK_BILLING_CUSTOMER.email);
      });
    });

    describe("Error Handling", () => {
      it("should catch and log errors from repository without throwing", async () => {
        const error = new Error("Database connection failed");
        billingCustomerRepository.findByStripeCustomerId.mockRejectedValue(error);

        await expect(
          service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId),
        ).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to queue subscription notification for ${stripeCustomerId}: Database connection failed`,
        );
        expect(emailQueue.add).not.toHaveBeenCalled();
      });

      it("should catch and log errors from queue without throwing", async () => {
        const error = new Error("Queue is full");
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockRejectedValue(error);

        await expect(
          service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId),
        ).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to queue subscription notification for ${stripeCustomerId}: Queue is full`,
        );
      });

      it("should handle unknown error types", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockRejectedValue("String error");

        await expect(
          service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId),
        ).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to queue subscription notification for ${stripeCustomerId}: Unknown error`,
        );
      });

      it("should not throw errors to prevent blocking webhook processing", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockRejectedValue(new Error("Critical error"));

        await expect(
          service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId),
        ).resolves.toBeUndefined();
      });
    });

    describe("Logging", () => {
      it("should log success message", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, status, subscriptionId);

        expect(logger.log).toHaveBeenCalledWith(
          `Queued subscription status change notification for customer ${stripeCustomerId}`,
        );
      });
    });

    describe("Subscription Status Values", () => {
      const statuses = ["active", "canceled", "incomplete", "incomplete_expired", "past_due", "trialing", "unpaid"];

      statuses.forEach((statusValue) => {
        it(`should handle '${statusValue}' status`, async () => {
          billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
          emailQueue.add.mockResolvedValue({} as any);

          await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, statusValue, subscriptionId);

          const addCall = emailQueue.add.mock.calls[0];
          expect(addCall[1].payload.status).toBe(statusValue);
        });
      });
    });

    describe("Edge Cases", () => {
      it("should preserve exact parameter values", async () => {
        const exactCustomerId = "cus_exact_123";
        const exactStatus = "canceled";
        const exactSubscriptionId = "sub_exact_456";

        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(exactCustomerId, exactStatus, exactSubscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.stripeCustomerId).toBe(exactCustomerId);
        expect(addCall[1].payload.status).toBe(exactStatus);
        expect(addCall[1].payload.subscriptionId).toBe(exactSubscriptionId);
      });

      it("should handle empty status string", async () => {
        billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
        emailQueue.add.mockResolvedValue({} as any);

        await service.sendSubscriptionStatusChangeEmail(stripeCustomerId, "", subscriptionId);

        const addCall = emailQueue.add.mock.calls[0];
        expect(addCall[1].payload.status).toBe("");
      });
    });
  });

  describe("Service Integration", () => {
    it("should call BillingCustomerRepository.findByStripeCustomerId for both methods", async () => {
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      await service.sendSubscriptionStatusChangeEmail(TEST_IDS.stripeCustomerId, "active", TEST_IDS.subscriptionId);

      expect(billingCustomerRepository.findByStripeCustomerId).toHaveBeenCalledTimes(2);
    });

    it("should use same BullMQ options for both notification types", async () => {
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      await service.sendSubscriptionStatusChangeEmail(TEST_IDS.stripeCustomerId, "active", TEST_IDS.subscriptionId);

      const calls = emailQueue.add.mock.calls;
      expect(calls[0][2]).toEqual(calls[1][2]);
    });

    it("should use same job name for both notification types", async () => {
      billingCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.stripeCustomerId,
      });

      await service.sendSubscriptionStatusChangeEmail(TEST_IDS.stripeCustomerId, "active", TEST_IDS.subscriptionId);

      const calls = emailQueue.add.mock.calls;
      expect(calls[0][0]).toBe("billing-notification");
      expect(calls[1][0]).toBe("billing-notification");
    });
  });
});
