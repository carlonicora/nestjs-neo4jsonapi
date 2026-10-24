import { vi, describe, it, expect, beforeEach, afterEach, type Mock, type Mocked } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  StripeWebhookNotificationService,
  StripeWebhookPaymentFailureNotificationParams,
} from "../stripe-webhook-notification.service";
import { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
import { StripeInvoiceRepository } from "../../../stripe-invoice/repositories/stripe-invoice.repository";
import { UserRepository } from "../../../user/repositories/user.repository";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { ClsService } from "nestjs-cls";
import { AppLoggingService } from "../../../../core/logging";
import { ResponseLanguageService } from "../../../user/services/response-language.service";
import { QueueId } from "../../../../config/enums/queue.id";
import { TEST_IDS } from "../../../stripe/__tests__/fixtures/stripe.fixtures";
import { BillingModuleConfig, resolveBillingConfig } from "../../../billing/interfaces/billing.config.interface";

describe("StripeWebhookNotificationService", () => {
  let service: StripeWebhookNotificationService;
  let emailQueue: Mocked<Queue>;
  let stripeCustomerRepository: Mocked<StripeCustomerRepository>;
  let stripeInvoiceRepository: Mocked<StripeInvoiceRepository>;
  let logger: Mocked<AppLoggingService>;
  let responseLanguage: { resolve: Mock; resolveForUser: Mock; resolveForEmail: Mock };

  const MOCK_STRIPE_CUSTOMER = {
    id: "internal_customer_id",
    stripeCustomerId: TEST_IDS.customerId,
    email: "customer@example.com",
    name: "Test Customer",
    currency: "usd",
    balance: 0,
    delinquent: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const MOCK_INVOICE = {
    id: "internal_invoice_id",
    stripeInvoiceId: TEST_IDS.invoiceId,
    stripeHostedInvoiceUrl: "https://invoice.stripe.com/pay/test_123",
    stripeInvoiceNumber: "INV-001",
    status: "open",
    amountDue: 999,
    currency: "usd",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockQueue = {
      add: vi.fn(),
    };

    const mockStripeCustomerRepository = {
      findByStripeCustomerId: vi.fn(),
    };

    const mockStripeInvoiceRepository = {
      findByStripeInvoiceId: vi.fn(),
    };

    const mockUserRepository = {
      findPlatformAdministrators: vi.fn(),
      findCompanyAdminsByStripeCustomerId: vi.fn(),
    };

    const mockCompanyRepository = {
      findByStripeCustomerId: vi.fn(),
    };

    const mockClsService = {
      run: vi.fn((callback) => callback()),
    };

    const mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    };

    responseLanguage = {
      resolve: vi.fn().mockResolvedValue(undefined),
      resolveForUser: vi.fn().mockResolvedValue(undefined),
      resolveForEmail: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookNotificationService,
        {
          provide: ResponseLanguageService,
          useValue: responseLanguage,
        },
        {
          provide: getQueueToken(QueueId.EMAIL),
          useValue: mockQueue,
        },
        {
          provide: StripeCustomerRepository,
          useValue: mockStripeCustomerRepository,
        },
        {
          provide: StripeInvoiceRepository,
          useValue: mockStripeInvoiceRepository,
        },
        {
          provide: UserRepository,
          useValue: mockUserRepository,
        },
        {
          provide: CompanyRepository,
          useValue: mockCompanyRepository,
        },
        {
          provide: ClsService,
          useValue: mockClsService,
        },
        {
          provide: AppLoggingService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<StripeWebhookNotificationService>(StripeWebhookNotificationService);
    emailQueue = module.get(getQueueToken(QueueId.EMAIL));
    stripeCustomerRepository = module.get(StripeCustomerRepository);
    stripeInvoiceRepository = module.get(StripeInvoiceRepository);
    logger = module.get(AppLoggingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("sendPaymentFailedEmail", () => {
    const baseParams: StripeWebhookPaymentFailureNotificationParams = {
      stripeCustomerId: TEST_IDS.customerId,
      stripeInvoiceId: TEST_IDS.invoiceId,
      amount: 9.99,
      currency: "usd",
      errorMessage: "Card declined",
    };

    it("should queue payment failure email successfully", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail(baseParams);

      expect(stripeCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(stripeInvoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: TEST_IDS.invoiceId,
      });
      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        {
          jobType: "payment-failure",
          payload: {
            to: MOCK_STRIPE_CUSTOMER.email,
            customerName: MOCK_STRIPE_CUSTOMER.name,
            stripeCustomerId: TEST_IDS.customerId,
            stripeInvoiceId: TEST_IDS.invoiceId,
            stripePaymentIntentId: undefined,
            errorMessage: "Card declined",
            amount: 9.99,
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
        expect.stringContaining(`Queued payment failure notification for customer ${TEST_IDS.customerId}`),
      );
    });

    it("should queue the payment failure email in the customer's saved language", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE as any);
      emailQueue.add.mockResolvedValue({} as any);
      responseLanguage.resolveForEmail.mockResolvedValue("it");

      await service.sendPaymentFailedEmail(baseParams);

      expect(responseLanguage.resolveForEmail).toHaveBeenCalledWith({ email: MOCK_STRIPE_CUSTOMER.email });
      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({ payload: expect.objectContaining({ locale: "it" }) }),
        expect.any(Object),
      );
    });

    it("should skip notification when customer not found", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

      await service.sendPaymentFailedEmail(baseParams);

      expect(logger.warn).toHaveBeenCalledWith(
        `Cannot send payment failure notification: Customer ${TEST_IDS.customerId} not found in Neo4j`,
      );
      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it("should handle missing invoice ID", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      const paramsWithoutInvoice: StripeWebhookPaymentFailureNotificationParams = {
        stripeCustomerId: TEST_IDS.customerId,
        amount: 9.99,
        currency: "usd",
      };

      await service.sendPaymentFailedEmail(paramsWithoutInvoice);

      expect(stripeInvoiceRepository.findByStripeInvoiceId).not.toHaveBeenCalled();
      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            stripeInvoiceId: undefined,
            invoiceUrl: undefined,
            invoiceNumber: undefined,
          }),
        }),
        expect.any(Object),
      );
    });

    it("should use payment intent ID when provided instead of invoice ID", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      const paramsWithPaymentIntent: StripeWebhookPaymentFailureNotificationParams = {
        stripeCustomerId: TEST_IDS.customerId,
        stripePaymentIntentId: TEST_IDS.paymentIntentId,
        amount: 10.0,
        currency: "usd",
        errorMessage: "Insufficient funds",
      };

      await service.sendPaymentFailedEmail(paramsWithPaymentIntent);

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            stripePaymentIntentId: TEST_IDS.paymentIntentId,
            stripeInvoiceId: undefined,
          }),
        }),
        expect.any(Object),
      );
    });

    it("should use default error message when not provided", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      const paramsWithoutError: StripeWebhookPaymentFailureNotificationParams = {
        stripeCustomerId: TEST_IDS.customerId,
        amount: 9.99,
        currency: "usd",
      };

      await service.sendPaymentFailedEmail(paramsWithoutError);

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            errorMessage: "Payment failed",
          }),
        }),
        expect.any(Object),
      );
    });

    it("should use default currency when not provided", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      const paramsWithoutCurrency: StripeWebhookPaymentFailureNotificationParams = {
        stripeCustomerId: TEST_IDS.customerId,
        amount: 9.99,
      };

      await service.sendPaymentFailedEmail(paramsWithoutCurrency);

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            currency: "usd",
          }),
        }),
        expect.any(Object),
      );
    });

    it("should use 'Customer' as default name when customer name is missing", async () => {
      const customerWithoutName = {
        ...MOCK_STRIPE_CUSTOMER,
        name: null,
      };
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(customerWithoutName as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail(baseParams);

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            customerName: "Customer",
          }),
        }),
        expect.any(Object),
      );
    });

    it("should handle queue error gracefully", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE as any);
      emailQueue.add.mockRejectedValue(new Error("Queue connection failed"));

      await service.sendPaymentFailedEmail(baseParams);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to queue payment failure notification for ${TEST_IDS.customerId}`),
      );
      // Should not throw - notification failure shouldn't block webhook processing
    });

    it("should handle unknown error types gracefully", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE as any);
      emailQueue.add.mockRejectedValue("string error");

      await service.sendPaymentFailedEmail(baseParams);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Unknown error"));
    });

    it("should handle invoice not found in local database", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail(baseParams);

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            invoiceUrl: undefined,
            invoiceNumber: undefined,
          }),
        }),
        expect.any(Object),
      );
    });

    it("should include invoice ID in log message when present", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(MOCK_INVOICE as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail(baseParams);

      expect(logger.log).toHaveBeenCalledWith(
        `Queued payment failure notification for customer ${TEST_IDS.customerId} (invoice: ${TEST_IDS.invoiceId})`,
      );
    });

    it("should not include invoice ID in log message when not present", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      const paramsWithoutInvoice: StripeWebhookPaymentFailureNotificationParams = {
        stripeCustomerId: TEST_IDS.customerId,
        amount: 9.99,
        currency: "usd",
      };

      await service.sendPaymentFailedEmail(paramsWithoutInvoice);

      expect(logger.log).toHaveBeenCalledWith(
        `Queued payment failure notification for customer ${TEST_IDS.customerId}`,
      );
    });
  });

  describe("sendSubscriptionStatusChangeEmail", () => {
    it("should queue subscription status change email successfully", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendSubscriptionStatusChangeEmail(TEST_IDS.customerId, "canceled", TEST_IDS.subscriptionId);

      expect(stripeCustomerRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        {
          jobType: "subscription-status-change",
          payload: {
            to: MOCK_STRIPE_CUSTOMER.email,
            customerName: MOCK_STRIPE_CUSTOMER.name,
            stripeCustomerId: TEST_IDS.customerId,
            subscriptionId: TEST_IDS.subscriptionId,
            status: "canceled",
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
        `Queued subscription status change notification for customer ${TEST_IDS.customerId}`,
      );
    });

    it("should skip notification when customer not found", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);

      await service.sendSubscriptionStatusChangeEmail(TEST_IDS.customerId, "canceled", TEST_IDS.subscriptionId);

      expect(logger.warn).toHaveBeenCalledWith(
        `Cannot send subscription notification: Customer ${TEST_IDS.customerId} not found in Neo4j`,
      );
      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it("should use 'Customer' as default name when customer name is missing", async () => {
      const customerWithoutName = {
        ...MOCK_STRIPE_CUSTOMER,
        name: null,
      };
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(customerWithoutName as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendSubscriptionStatusChangeEmail(TEST_IDS.customerId, "active", TEST_IDS.subscriptionId);

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            customerName: "Customer",
          }),
        }),
        expect.any(Object),
      );
    });

    it("should handle queue error gracefully", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockRejectedValue(new Error("Queue connection failed"));

      await service.sendSubscriptionStatusChangeEmail(TEST_IDS.customerId, "canceled", TEST_IDS.subscriptionId);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to queue subscription notification for ${TEST_IDS.customerId}`),
      );
      // Should not throw - notification failure shouldn't block webhook processing
    });

    it("should handle unknown error types gracefully", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockRejectedValue("string error");

      await service.sendSubscriptionStatusChangeEmail(TEST_IDS.customerId, "canceled", TEST_IDS.subscriptionId);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Unknown error"));
    });

    it("should handle different subscription statuses", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      const statuses = ["active", "canceled", "past_due", "unpaid", "trialing", "paused"];

      for (const status of statuses) {
        vi.clearAllMocks();
        stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);

        await service.sendSubscriptionStatusChangeEmail(TEST_IDS.customerId, status, TEST_IDS.subscriptionId);

        expect(emailQueue.add).toHaveBeenCalledWith(
          "billing-notification",
          expect.objectContaining({
            payload: expect.objectContaining({
              status,
            }),
          }),
          expect.any(Object),
        );
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle customer with empty email", async () => {
      const customerWithEmptyEmail = {
        ...MOCK_STRIPE_CUSTOMER,
        email: "",
      };
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(customerWithEmptyEmail as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.customerId,
        amount: 9.99,
        currency: "usd",
      });

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            to: "",
          }),
        }),
        expect.any(Object),
      );
    });

    it("should handle zero amount", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.customerId,
        amount: 0,
        currency: "usd",
      });

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            amount: 0,
          }),
        }),
        expect.any(Object),
      );
    });

    it("should handle undefined amount", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.customerId,
      });

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            amount: undefined,
          }),
        }),
        expect.any(Object),
      );
    });

    it("should handle invoice with missing invoice number", async () => {
      const invoiceWithoutNumber = {
        ...MOCK_INVOICE,
        stripeInvoiceNumber: null,
      };
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(invoiceWithoutNumber as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.customerId,
        stripeInvoiceId: TEST_IDS.invoiceId,
        amount: 9.99,
        currency: "usd",
      });

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            invoiceNumber: undefined,
          }),
        }),
        expect.any(Object),
      );
    });
  });

  describe("Service Integration", () => {
    it("should call services in correct order for payment failure", async () => {
      const callOrder: string[] = [];

      stripeCustomerRepository.findByStripeCustomerId.mockImplementation(async () => {
        callOrder.push("findCustomer");
        return MOCK_STRIPE_CUSTOMER as any;
      });
      stripeInvoiceRepository.findByStripeInvoiceId.mockImplementation(async () => {
        callOrder.push("findInvoice");
        return MOCK_INVOICE as any;
      });
      emailQueue.add.mockImplementation(async () => {
        callOrder.push("queueEmail");
        return {} as any;
      });

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.customerId,
        stripeInvoiceId: TEST_IDS.invoiceId,
        amount: 9.99,
        currency: "usd",
      });

      expect(callOrder).toEqual(["findCustomer", "findInvoice", "queueEmail"]);
    });

    it("should use correct queue job configuration", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendPaymentFailedEmail({
        stripeCustomerId: TEST_IDS.customerId,
        amount: 9.99,
        currency: "usd",
      });

      expect(emailQueue.add).toHaveBeenCalledWith("billing-notification", expect.any(Object), {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      });
    });
  });

  describe("sendDeletionWarningEmail", () => {
    let companyRepository: Mocked<CompanyRepository>;
    let userRepository: Mocked<UserRepository>;

    const MOCK_COMPANY = {
      id: "company-test-123",
      name: "Test Company",
      ownerEmail: "owner@test.com",
    };

    const MOCK_ADMIN = {
      id: "admin-user-123",
      email: "admin@test.com",
      name: "Admin User",
    };

    beforeEach(() => {
      companyRepository = service["companyRepository"] as Mocked<CompanyRepository>;
      userRepository = service["userRepository"] as Mocked<UserRepository>;
    });

    it("should log warning and return when company not found", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(null);

      await service.sendDeletionWarningEmail({
        companyId: "nonexistent",
        daysRemaining: 7,
        deletionDate: new Date("2025-02-25"),
        reason: "trial_expired",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Cannot send deletion warning: company nonexistent not found"),
      );
      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it("should log warning and return when no admins found", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      userRepository.findAdminsByCompanyId = vi.fn().mockResolvedValue([]);

      await service.sendDeletionWarningEmail({
        companyId: MOCK_COMPANY.id,
        daysRemaining: 7,
        deletionDate: new Date("2025-02-25"),
        reason: "trial_expired",
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no admins found"));
      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it("should queue email for each admin with correct payload", async () => {
      const mockAdmins = [
        { ...MOCK_ADMIN, id: "admin-1", email: "admin1@test.com" },
        { ...MOCK_ADMIN, id: "admin-2", email: "admin2@test.com" },
      ];
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      userRepository.findAdminsByCompanyId = vi.fn().mockResolvedValue(mockAdmins);
      emailQueue.add.mockResolvedValue({} as any);

      const deletionDate = new Date("2025-02-25");
      await service.sendDeletionWarningEmail({
        companyId: MOCK_COMPANY.id,
        daysRemaining: 7,
        deletionDate,
        reason: "trial_expired",
      });

      expect(emailQueue.add).toHaveBeenCalledTimes(2);
      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          jobType: "deletion-warning",
          payload: expect.objectContaining({
            to: "admin1@test.com",
            companyName: MOCK_COMPANY.name,
            daysRemaining: 7,
            deletionDate: deletionDate.toISOString(),
            reason: "trial_expired",
            isTrialExpired: true,
            isSubscriptionCancelled: false,
          }),
        }),
        expect.any(Object),
      );
    });

    it("should queue each admin's email in that admin's saved language", async () => {
      const mockAdmins = [
        { ...MOCK_ADMIN, id: "admin-1", email: "admin1@test.com" },
        { ...MOCK_ADMIN, id: "admin-2", email: "admin2@test.com" },
      ];
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      userRepository.findAdminsByCompanyId = vi.fn().mockResolvedValue(mockAdmins);
      emailQueue.add.mockResolvedValue({} as any);
      responseLanguage.resolveForUser.mockImplementation(async ({ userId }: { userId: string }) =>
        userId === "admin-1" ? "it" : undefined,
      );

      await service.sendDeletionWarningEmail({
        companyId: MOCK_COMPANY.id,
        daysRemaining: 7,
        deletionDate: new Date("2025-02-25"),
        reason: "trial_expired",
      });

      const payloads = emailQueue.add.mock.calls.map((call: any[]) => call[1].payload);
      expect(payloads.find((p: any) => p.to === "admin1@test.com").locale).toBe("it");
      expect(payloads.find((p: any) => p.to === "admin2@test.com").locale).toBe("en");
    });

    it("should set correct flags for trial_expired reason", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      userRepository.findAdminsByCompanyId = vi.fn().mockResolvedValue([MOCK_ADMIN]);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendDeletionWarningEmail({
        companyId: MOCK_COMPANY.id,
        daysRemaining: 7,
        deletionDate: new Date(),
        reason: "trial_expired",
      });

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            isTrialExpired: true,
            isSubscriptionCancelled: false,
          }),
        }),
        expect.any(Object),
      );
    });

    it("should set correct flags for subscription_cancelled reason", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      userRepository.findAdminsByCompanyId = vi.fn().mockResolvedValue([MOCK_ADMIN]);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendDeletionWarningEmail({
        companyId: MOCK_COMPANY.id,
        daysRemaining: 7,
        deletionDate: new Date(),
        reason: "subscription_cancelled",
      });

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            isTrialExpired: false,
            isSubscriptionCancelled: true,
          }),
        }),
        expect.any(Object),
      );
    });

    it("should catch and log errors without throwing", async () => {
      companyRepository.findByCompanyId = vi.fn().mockRejectedValue(new Error("Database error"));

      await service.sendDeletionWarningEmail({
        companyId: MOCK_COMPANY.id,
        daysRemaining: 7,
        deletionDate: new Date(),
        reason: "trial_expired",
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to queue deletion warning notification"),
      );
    });
  });

  describe("sendSubscriptionCancelledEmail", () => {
    let companyRepository: Mocked<CompanyRepository>;
    let userRepository: Mocked<UserRepository>;

    const MOCK_COMPANY = {
      id: "company-test-123",
      name: "Test Company",
    };

    const MOCK_ADMINS = [
      { id: "admin-1", email: "admin1@test.com", name: "Admin One" },
      { id: "admin-2", email: "admin2@test.com", name: "Admin Two" },
    ];

    beforeEach(() => {
      companyRepository = service["companyRepository"] as Mocked<CompanyRepository>;
      userRepository = service["userRepository"] as Mocked<UserRepository>;
      userRepository.findAdminsByCompanyId = vi.fn().mockResolvedValue([MOCK_ADMINS[0]]);
    });

    it("should log warning and return when company not found", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(null);

      await service.sendSubscriptionCancelledEmail({
        companyId: "nonexistent",
        dataRemovalDate: new Date("2025-02-25"),
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Cannot send cancellation email: company nonexistent not found"),
      );
      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it("should log warning and return when the company has no admins", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      userRepository.findAdminsByCompanyId = vi.fn().mockResolvedValue([]);

      await service.sendSubscriptionCancelledEmail({
        companyId: MOCK_COMPANY.id,
        dataRemovalDate: new Date("2025-02-25"),
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no admins found"));
      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it("should queue email with correct payload", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      emailQueue.add.mockResolvedValue({} as any);

      const dataRemovalDate = new Date("2025-02-25");
      await service.sendSubscriptionCancelledEmail({
        companyId: MOCK_COMPANY.id,
        dataRemovalDate,
      });

      expect(userRepository.findAdminsByCompanyId).toHaveBeenCalledWith({ companyId: MOCK_COMPANY.id });
      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        {
          jobType: "subscription-cancelled",
          payload: {
            to: MOCK_ADMINS[0].email,
            companyName: MOCK_COMPANY.name,
            dataRemovalDate: dataRemovalDate.toISOString(),
            locale: "en",
          },
        },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        },
      );
    });

    it("should queue one email per admin, each in that admin's language", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      userRepository.findAdminsByCompanyId = vi.fn().mockResolvedValue(MOCK_ADMINS);
      responseLanguage.resolveForUser.mockImplementation(async ({ userId }: { userId: string }) =>
        userId === "admin-2" ? "it" : undefined,
      );
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendSubscriptionCancelledEmail({
        companyId: MOCK_COMPANY.id,
        dataRemovalDate: new Date("2025-02-25"),
      });

      expect(emailQueue.add).toHaveBeenCalledTimes(2);
      expect(emailQueue.add).toHaveBeenNthCalledWith(
        1,
        "billing-notification",
        expect.objectContaining({ payload: expect.objectContaining({ to: "admin1@test.com", locale: "en" }) }),
        expect.any(Object),
      );
      expect(emailQueue.add).toHaveBeenNthCalledWith(
        2,
        "billing-notification",
        expect.objectContaining({ payload: expect.objectContaining({ to: "admin2@test.com", locale: "it" }) }),
        expect.any(Object),
      );
    });

    it("should catch and log errors without throwing", async () => {
      companyRepository.findByCompanyId = vi.fn().mockRejectedValue(new Error("Database error"));

      await service.sendSubscriptionCancelledEmail({
        companyId: MOCK_COMPANY.id,
        dataRemovalDate: new Date(),
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to queue subscription cancelled notification"),
      );
    });

    it("should log success message when email queued", async () => {
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(MOCK_COMPANY);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendSubscriptionCancelledEmail({
        companyId: MOCK_COMPANY.id,
        dataRemovalDate: new Date(),
      });

      expect(logger.log).toHaveBeenCalledWith(
        `Queued subscription cancelled email for company ${MOCK_COMPANY.id} (1 admins)`,
      );
    });

    it("should use default company name when name is missing", async () => {
      const companyWithoutName = { ...MOCK_COMPANY, name: null };
      companyRepository.findByCompanyId = vi.fn().mockResolvedValue(companyWithoutName);
      emailQueue.add.mockResolvedValue({} as any);

      await service.sendSubscriptionCancelledEmail({
        companyId: MOCK_COMPANY.id,
        dataRemovalDate: new Date(),
      });

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          payload: expect.objectContaining({
            companyName: "Your company",
          }),
        }),
        expect.any(Object),
      );
    });
  });

  describe("billing emails (BillingModule)", () => {
    let userRepository: Mocked<UserRepository>;
    let companyRepository: Mocked<CompanyRepository>;

    const MOCK_ADMINS = [
      { id: "admin-1", email: "admin1@test.com", name: "Admin One" },
      { id: "admin-2", email: "admin2@test.com", name: "Admin Two" },
    ];

    /** The same service, built with an app's billing config. */
    const withBillingConfig = (config: BillingModuleConfig) =>
      new StripeWebhookNotificationService(
        emailQueue,
        stripeCustomerRepository,
        stripeInvoiceRepository,
        userRepository,
        companyRepository,
        service["cls"],
        logger,
        service["responseLanguage"],
        resolveBillingConfig(config),
      );

    beforeEach(() => {
      userRepository = service["userRepository"] as Mocked<UserRepository>;
      companyRepository = service["companyRepository"] as Mocked<CompanyRepository>;
      emailQueue.add.mockResolvedValue({} as any);
    });

    it("sendCardExpiringEmail queues card-expiring for each company admin", async () => {
      userRepository.findCompanyAdminsByStripeCustomerId.mockResolvedValue(MOCK_ADMINS as any);
      responseLanguage.resolveForUser.mockImplementation(async ({ userId }: { userId: string }) =>
        userId === "admin-2" ? "it" : undefined,
      );
      const renewalDate = new Date("2026-12-03T00:00:00Z");

      await service.sendCardExpiringEmail({
        stripeCustomerId: TEST_IDS.customerId,
        renewalDate,
        cardBrand: "visa",
        cardLast4: "4242",
      });

      expect(userRepository.findCompanyAdminsByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(emailQueue.add).toHaveBeenCalledTimes(2);
      expect(emailQueue.add).toHaveBeenNthCalledWith(
        1,
        "billing-notification",
        {
          jobType: "card-expiring",
          payload: {
            to: "admin1@test.com",
            customerName: "Admin One",
            stripeCustomerId: TEST_IDS.customerId,
            renewalDate: renewalDate.toISOString(),
            cardBrand: "visa",
            cardLast4: "4242",
            locale: "en",
          },
        },
        { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
      );
      expect(emailQueue.add).toHaveBeenNthCalledWith(
        2,
        "billing-notification",
        expect.objectContaining({
          jobType: "card-expiring",
          payload: expect.objectContaining({ to: "admin2@test.com", locale: "it" }),
        }),
        expect.any(Object),
      );
    });

    it("sendCardExpiringEmail skips when the company has no admins", async () => {
      userRepository.findCompanyAdminsByStripeCustomerId.mockResolvedValue([]);

      await service.sendCardExpiringEmail({
        stripeCustomerId: TEST_IDS.customerId,
        renewalDate: new Date(),
        cardBrand: "visa",
        cardLast4: "4242",
      });

      expect(emailQueue.add).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("skipping card expiring warning"));
    });

    it("payment failure payload carries keepsAccess", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);

      await service.sendPaymentFailedEmail({ stripeCustomerId: TEST_IDS.customerId, keepsAccess: true });

      expect(emailQueue.add).toHaveBeenCalledWith(
        "billing-notification",
        expect.objectContaining({
          jobType: "payment-failure",
          payload: expect.objectContaining({ keepsAccess: true }),
        }),
        expect.any(Object),
      );
    });

    it("payment failure payload is unchanged when keepsAccess is not given", async () => {
      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);

      await service.sendPaymentFailedEmail({ stripeCustomerId: TEST_IDS.customerId });

      const payload = (emailQueue.add.mock.calls[0][1] as { payload: Record<string, unknown> }).payload;
      expect(payload).not.toHaveProperty("keepsAccess");
    });

    describe("each billing email is skipped when its switch is off", () => {
      it("paymentFailed", async () => {
        stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(MOCK_STRIPE_CUSTOMER as any);

        await withBillingConfig({ emails: { paymentFailed: false } }).sendPaymentFailedEmail({
          stripeCustomerId: TEST_IDS.customerId,
        });

        expect(stripeCustomerRepository.findByStripeCustomerId).not.toHaveBeenCalled();
        expect(emailQueue.add).not.toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('"paymentFailed" is switched off'));
      });

      it("cardExpiring", async () => {
        userRepository.findCompanyAdminsByStripeCustomerId.mockResolvedValue(MOCK_ADMINS as any);

        await withBillingConfig({ emails: { cardExpiring: false } }).sendCardExpiringEmail({
          stripeCustomerId: TEST_IDS.customerId,
          renewalDate: new Date(),
          cardBrand: "visa",
          cardLast4: "4242",
        });

        expect(userRepository.findCompanyAdminsByStripeCustomerId).not.toHaveBeenCalled();
        expect(emailQueue.add).not.toHaveBeenCalled();
      });

      it("subscriptionEnded", async () => {
        companyRepository.findByCompanyId = vi.fn().mockResolvedValue({ id: "company-1", name: "Acme" });

        await withBillingConfig({ emails: { subscriptionEnded: false } }).sendSubscriptionCancelledEmail({
          companyId: "company-1",
          dataRemovalDate: new Date(),
        });

        expect(companyRepository.findByCompanyId).not.toHaveBeenCalled();
        expect(emailQueue.add).not.toHaveBeenCalled();
      });

      it("keeps the other emails on when one is off", async () => {
        userRepository.findCompanyAdminsByStripeCustomerId.mockResolvedValue([MOCK_ADMINS[0]] as any);

        await withBillingConfig({ emails: { paymentFailed: false } }).sendCardExpiringEmail({
          stripeCustomerId: TEST_IDS.customerId,
          renewalDate: new Date(),
          cardBrand: "visa",
          cardLast4: "4242",
        });

        expect(emailQueue.add).toHaveBeenCalledTimes(1);
      });
    });
  });
});
