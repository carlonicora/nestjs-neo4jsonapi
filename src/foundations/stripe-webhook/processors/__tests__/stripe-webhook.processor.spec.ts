import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the stripe-webhook module to prevent the conditional provider loading issue
vi.mock("../../stripe-webhook.module", () => ({
  StripeWebhookModule: class {},
}));

// Mock the barrel export to provide the imports needed
vi.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = vi.importActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import Stripe from "stripe";
import { StripeWebhookProcessor, StripeWebhookJobData } from "../stripe-webhook.processor";
import { StripeWebhookEventRepository } from "../../repositories/stripe-webhook-event.repository";
import { StripeWebhookNotificationService } from "../../services/stripe-webhook-notification.service";
import { StripeSubscriptionAdminService } from "../../../stripe-subscription/services/stripe-subscription-admin.service";
import { FeatureSyncService } from "../../../stripe-subscription/services/feature-sync.service";
import { TokenAllocationService } from "../../../stripe-subscription/services/token-allocation.service";
import { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
import { StripeSubscriptionRepository } from "../../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeInvoiceRepository } from "../../../stripe-invoice/repositories/stripe-invoice.repository";
import { StripePriceRepository } from "../../../stripe-price/repositories/stripe-price.repository";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { AppLoggingService } from "../../../../core/logging";
import { StripeService } from "../../../stripe/services/stripe.service";
import { StripeInvoiceAdminService } from "../../../stripe-invoice/services/stripe-invoice-admin.service";
import { WebSocketService } from "../../../../core/websocket/services/websocket.service";
import {
  MOCK_SUBSCRIPTION,
  MOCK_INVOICE,
  MOCK_PAYMENT_INTENT,
  MOCK_CUSTOMER,
  MOCK_DELETED_CUSTOMER,
  TEST_IDS,
} from "../../../stripe/__tests__/fixtures/stripe.fixtures";

describe("StripeWebhookProcessor", () => {
  let processor: StripeWebhookProcessor;
  let stripeWebhookEventRepository: vi.Mocked<StripeWebhookEventRepository>;
  let subscriptionService: vi.Mocked<StripeSubscriptionAdminService>;
  let stripeCustomerRepository: vi.Mocked<StripeCustomerRepository>;
  let subscriptionRepository: vi.Mocked<StripeSubscriptionRepository>;
  let stripeInvoiceRepository: vi.Mocked<StripeInvoiceRepository>;
  let companyRepository: vi.Mocked<CompanyRepository>;
  let notificationService: vi.Mocked<StripeWebhookNotificationService>;
  let logger: vi.Mocked<AppLoggingService>;

  const TEST_DATA = {
    webhookEventId: "550e8400-e29b-41d4-a716-446655440000",
    stripeEventId: "evt_test_12345678",
  };

  const createMockJob = (eventType: string, payload: Record<string, any>): Job<StripeWebhookJobData> => {
    return {
      id: "job_123",
      data: {
        webhookEventId: TEST_DATA.webhookEventId,
        stripeEventId: TEST_DATA.stripeEventId,
        eventType,
        payload,
      },
      failedReason: undefined,
    } as unknown as Job<StripeWebhookJobData>;
  };

  beforeEach(async () => {
    const mockStripeWebhookEventRepository = {
      updateStatus: vi.fn(),
    };

    const mockSubscriptionService = {
      syncSubscriptionFromStripe: vi.fn(),
    };

    const mockStripeCustomerRepository = {
      updateByStripeCustomerId: vi.fn(),
      findByStripeCustomerId: vi.fn(),
    };

    const mockCompanyRepository = {
      findByStripeCustomerId: vi.fn(),
      markSubscriptionStatus: vi.fn(),
    };

    const mockSubscriptionRepository = {
      cancelAllByStripeCustomerId: vi.fn(),
      findByStripeSubscriptionId: vi.fn().mockResolvedValue(null),
    };

    const mockStripeInvoiceRepository = {
      findByStripeInvoiceId: vi.fn(),
      updateByStripeInvoiceId: vi.fn(),
    };

    const mockStripePriceRepository = {
      findByStripePriceId: vi.fn(),
    };

    const mockTokenAllocationService = {
      allocateTokensOnPayment: vi.fn().mockResolvedValue({ success: true, tokensAllocated: 0 }),
      allocateProratedTokensOnPlanChange: vi.fn().mockResolvedValue({ success: true, tokensAllocated: 0 }),
    };

    const mockFeatureSyncService = {
      syncFeaturesOnPayment: vi.fn().mockResolvedValue({ success: true, featuresAdded: [] }),
      removeFeaturesOnSubscriptionEnd: vi.fn().mockResolvedValue({ success: true, featuresRemoved: [] }),
    };

    const mockNotificationService = {
      sendPaymentFailedEmail: vi.fn(),
      sendSubscriptionStatusChangeEmail: vi.fn(),
    };

    const mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    };

    const mockStripeService = {
      getClient: vi.fn().mockReturnValue({
        invoices: {
          retrieve: vi.fn(),
        },
      }),
    };

    const mockStripeInvoiceAdminService = {
      syncInvoiceFromStripe: vi.fn().mockResolvedValue({}),
    };

    const mockClsService = {
      run: vi.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
      get: vi.fn(),
      set: vi.fn(),
      has: vi.fn().mockReturnValue(false),
    };

    const mockWebSocketService = {
      sendMessageToCompany: vi.fn().mockResolvedValue(undefined),
      sendMessageToUser: vi.fn().mockResolvedValue(undefined),
      broadcast: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookProcessor,
        {
          provide: StripeWebhookEventRepository,
          useValue: mockStripeWebhookEventRepository,
        },
        {
          provide: StripeSubscriptionAdminService,
          useValue: mockSubscriptionService,
        },
        {
          provide: StripeCustomerRepository,
          useValue: mockStripeCustomerRepository,
        },
        {
          provide: StripeSubscriptionRepository,
          useValue: mockSubscriptionRepository,
        },
        {
          provide: StripeInvoiceRepository,
          useValue: mockStripeInvoiceRepository,
        },
        {
          provide: StripePriceRepository,
          useValue: mockStripePriceRepository,
        },
        {
          provide: StripeWebhookNotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: TokenAllocationService,
          useValue: mockTokenAllocationService,
        },
        {
          provide: FeatureSyncService,
          useValue: mockFeatureSyncService,
        },
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
        {
          provide: CompanyRepository,
          useValue: mockCompanyRepository,
        },
        {
          provide: StripeInvoiceAdminService,
          useValue: mockStripeInvoiceAdminService,
        },
        {
          provide: AppLoggingService,
          useValue: mockLogger,
        },
        {
          provide: ClsService,
          useValue: mockClsService,
        },
        {
          provide: WebSocketService,
          useValue: mockWebSocketService,
        },
      ],
    }).compile();

    processor = module.get<StripeWebhookProcessor>(StripeWebhookProcessor);
    stripeWebhookEventRepository = module.get(StripeWebhookEventRepository);
    subscriptionService = module.get(StripeSubscriptionAdminService);
    stripeCustomerRepository = module.get(StripeCustomerRepository);
    subscriptionRepository = module.get(StripeSubscriptionRepository);
    stripeInvoiceRepository = module.get(StripeInvoiceRepository);
    companyRepository = module.get(CompanyRepository);
    notificationService = module.get(StripeWebhookNotificationService);
    logger = module.get(AppLoggingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("process", () => {
    it("should update status to processing and then completed on success", async () => {
      const job = createMockJob("customer.subscription.created", MOCK_SUBSCRIPTION as unknown as Record<string, any>);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "processing",
      });
      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "completed",
        processedAt: expect.any(Date),
      });
    });

    it("should update status to failed and increment retry count on error", async () => {
      const job = createMockJob("customer.subscription.created", MOCK_SUBSCRIPTION as unknown as Record<string, any>);
      const error = new Error("Processing failed");
      subscriptionService.syncSubscriptionFromStripe.mockRejectedValue(error);

      await expect(processor.process(job)).rejects.toThrow("Processing failed");

      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "processing",
      });
      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "failed",
        error: "Processing failed",
        incrementRetryCount: true,
      });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to process webhook"));
    });

    it("should handle unknown error types gracefully", async () => {
      const job = createMockJob("customer.subscription.created", MOCK_SUBSCRIPTION as unknown as Record<string, any>);
      subscriptionService.syncSubscriptionFromStripe.mockRejectedValue("string error");

      await expect(processor.process(job)).rejects.toBe("string error");

      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "failed",
        error: "Unknown error",
        incrementRetryCount: true,
      });
    });
  });

  describe("Subscription Events", () => {
    it("should handle customer.subscription.created event", async () => {
      const job = createMockJob("customer.subscription.created", MOCK_SUBSCRIPTION as unknown as Record<string, any>);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
        stripeSubscriptionId: MOCK_SUBSCRIPTION.id,
      });
    });

    it("should handle customer.subscription.updated event", async () => {
      const job = createMockJob("customer.subscription.updated", MOCK_SUBSCRIPTION as unknown as Record<string, any>);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
        stripeSubscriptionId: MOCK_SUBSCRIPTION.id,
      });
    });

    it("should handle customer.subscription.deleted event", async () => {
      const job = createMockJob("customer.subscription.deleted", MOCK_SUBSCRIPTION as unknown as Record<string, any>);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
        stripeSubscriptionId: MOCK_SUBSCRIPTION.id,
      });
    });

    it("should NOT mark company subscription as active when subscription status is active (waits for invoice.paid)", async () => {
      // The subscription should only be marked active when payment is confirmed (invoice.paid event),
      // not when the subscription status changes to "active". This is handled by TokenAllocationService.
      const activeSubscription = {
        ...MOCK_SUBSCRIPTION,
        status: "active",
      };
      const job = createMockJob("customer.subscription.updated", activeSubscription as unknown as Record<string, any>);

      const mockStripeCustomer = { id: "internal-customer-id", stripeCustomerId: TEST_IDS.customerId };
      const mockCompany = { id: "company-id" };

      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(mockStripeCustomer as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(mockCompany as any);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      // Should NOT mark subscription as active here - that happens on invoice.paid
      expect(companyRepository.markSubscriptionStatus).not.toHaveBeenCalled();
    });

    it("should mark company subscription as inactive when subscription status is canceled", async () => {
      const canceledSubscription = {
        ...MOCK_SUBSCRIPTION,
        status: "canceled",
      };
      const job = createMockJob(
        "customer.subscription.deleted",
        canceledSubscription as unknown as Record<string, any>,
      );

      const mockStripeCustomer = { id: "internal-customer-id", stripeCustomerId: TEST_IDS.customerId };
      const mockCompany = { id: "company-id" };

      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(mockStripeCustomer as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(mockCompany as any);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(companyRepository.markSubscriptionStatus).toHaveBeenCalledWith({
        companyId: "company-id",
        isActiveSubscription: false,
      });
    });

    it("should not fail webhook when company subscription status update fails (canceled)", async () => {
      // Test that we handle DB errors gracefully when marking subscription inactive on cancellation
      const canceledSubscription = {
        ...MOCK_SUBSCRIPTION,
        status: "canceled",
      };
      const job = createMockJob(
        "customer.subscription.updated",
        canceledSubscription as unknown as Record<string, any>,
      );

      const mockStripeCustomer = { id: "internal-customer-id", stripeCustomerId: TEST_IDS.customerId };
      const mockCompany = { id: "company-id" };

      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(mockStripeCustomer as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(mockCompany as any);
      companyRepository.markSubscriptionStatus.mockRejectedValue(new Error("DB error"));
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      // Should still complete successfully
      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "completed",
        processedAt: expect.any(Date),
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update company subscription status"),
      );
    });

    it("should not update subscription status when stripe customer not found (canceled)", async () => {
      // Test that we gracefully handle missing stripe customer when trying to mark inactive
      const canceledSubscription = {
        ...MOCK_SUBSCRIPTION,
        status: "canceled",
      };
      const job = createMockJob(
        "customer.subscription.updated",
        canceledSubscription as unknown as Record<string, any>,
      );

      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(null);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(companyRepository.markSubscriptionStatus).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not found in database"));
    });

    it("should not update subscription status when company not found (canceled)", async () => {
      // Test that we gracefully handle missing company when trying to mark inactive
      const canceledSubscription = {
        ...MOCK_SUBSCRIPTION,
        status: "canceled",
      };
      const job = createMockJob(
        "customer.subscription.updated",
        canceledSubscription as unknown as Record<string, any>,
      );

      const mockStripeCustomer = { id: "internal-customer-id", stripeCustomerId: TEST_IDS.customerId };

      stripeCustomerRepository.findByStripeCustomerId.mockResolvedValue(mockStripeCustomer as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(null);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(companyRepository.markSubscriptionStatus).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Company not found"));
    });
  });

  describe("Invoice Events", () => {
    it("should handle invoice.paid event and sync subscription", async () => {
      const invoiceWithSubscription = {
        ...MOCK_INVOICE,
        parent: {
          subscription_details: {
            subscription: TEST_IDS.subscriptionId,
          },
        },
      };
      const job = createMockJob("invoice.paid", invoiceWithSubscription as unknown as Record<string, any>);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
        stripeSubscriptionId: TEST_IDS.subscriptionId,
      });
    });

    it("should handle invoice.payment_failed event", async () => {
      const failedInvoice = {
        ...MOCK_INVOICE,
        attempt_count: 2,
        last_finalization_error: { message: "Card declined" },
      };
      const job = createMockJob("invoice.payment_failed", failedInvoice as unknown as Record<string, any>);

      const mockLocalInvoice = {
        id: "local_invoice_id",
        stripeInvoiceId: MOCK_INVOICE.id,
      };
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(mockLocalInvoice as any);
      stripeInvoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
      notificationService.sendPaymentFailedEmail.mockResolvedValue();

      await processor.process(job);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Payment failed for invoice ${MOCK_INVOICE.id}`),
      );
      expect(stripeInvoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: MOCK_INVOICE.id,
      });
      expect(stripeInvoiceRepository.updateByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: MOCK_INVOICE.id,
        status: "uncollectible",
        attemptCount: 2,
        attempted: true,
      });
      expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        stripeInvoiceId: MOCK_INVOICE.id,
        amount: MOCK_INVOICE.amount_due / 100,
        currency: MOCK_INVOICE.currency,
        errorMessage: "Card declined",
      });
    });

    it("should skip notification when invoice not found in local database", async () => {
      const failedInvoice = {
        ...MOCK_INVOICE,
        attempt_count: 1,
      };
      const job = createMockJob("invoice.payment_failed", failedInvoice as unknown as Record<string, any>);
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);

      await processor.process(job);

      expect(logger.warn).toHaveBeenCalledWith(
        `Invoice ${MOCK_INVOICE.id} not found in local database - skipping notification`,
      );
      expect(notificationService.sendPaymentFailedEmail).not.toHaveBeenCalled();
    });

    it("should handle notification failure gracefully for invoice.payment_failed", async () => {
      const failedInvoice = {
        ...MOCK_INVOICE,
        attempt_count: 1,
      };
      const job = createMockJob("invoice.payment_failed", failedInvoice as unknown as Record<string, any>);

      const mockLocalInvoice = {
        id: "local_invoice_id",
        stripeInvoiceId: MOCK_INVOICE.id,
      };
      stripeInvoiceRepository.findByStripeInvoiceId.mockResolvedValue(mockLocalInvoice as any);
      stripeInvoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
      notificationService.sendPaymentFailedEmail.mockRejectedValue(new Error("Email failed"));

      await processor.process(job);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to send payment failure notification for invoice ${MOCK_INVOICE.id}`),
      );
      // Should still complete successfully since notification failure shouldn't fail the webhook
      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "completed",
        processedAt: expect.any(Date),
      });
    });

    it("should skip processing when invoice has no customer ID", async () => {
      const invoiceWithoutCustomer = {
        ...MOCK_INVOICE,
        customer: null,
      };
      const job = createMockJob("invoice.payment_failed", invoiceWithoutCustomer as unknown as Record<string, any>);

      await processor.process(job);

      expect(logger.warn).toHaveBeenCalledWith(`Invoice ${MOCK_INVOICE.id} has no customer ID`);
      expect(notificationService.sendPaymentFailedEmail).not.toHaveBeenCalled();
    });
  });

  describe("Customer Events", () => {
    it("should handle customer.updated event", async () => {
      const job = createMockJob("customer.updated", MOCK_CUSTOMER as unknown as Record<string, any>);
      stripeCustomerRepository.updateByStripeCustomerId.mockResolvedValue({} as any);

      await processor.process(job);

      expect(stripeCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_CUSTOMER.id,
        email: MOCK_CUSTOMER.email || undefined,
        name: MOCK_CUSTOMER.name || undefined,
      });
    });

    it("should handle customer.deleted event", async () => {
      const job = createMockJob("customer.deleted", MOCK_DELETED_CUSTOMER as unknown as Record<string, any>);
      subscriptionRepository.cancelAllByStripeCustomerId.mockResolvedValue(2);

      await processor.process(job);

      expect(logger.warn).toHaveBeenCalledWith(`Customer ${MOCK_DELETED_CUSTOMER.id} was deleted in Stripe`);
      expect(subscriptionRepository.cancelAllByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_DELETED_CUSTOMER.id,
      });
      expect(logger.log).toHaveBeenCalledWith(
        `Canceled 2 subscription(s) for deleted customer ${MOCK_DELETED_CUSTOMER.id}`,
      );
    });
  });

  describe("Payment Intent Events", () => {
    it("should handle payment_intent.succeeded event", async () => {
      const job = createMockJob("payment_intent.succeeded", MOCK_PAYMENT_INTENT as unknown as Record<string, any>);

      await processor.process(job);

      // Should complete without errors for succeeded events
      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "completed",
        processedAt: expect.any(Date),
      });
    });

    it("should handle payment_intent.payment_failed event", async () => {
      const failedPaymentIntent = {
        ...MOCK_PAYMENT_INTENT,
        last_payment_error: { message: "Card declined" },
      };
      const job = createMockJob("payment_intent.payment_failed", failedPaymentIntent as unknown as Record<string, any>);
      notificationService.sendPaymentFailedEmail.mockResolvedValue();

      await processor.process(job);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Payment intent ${MOCK_PAYMENT_INTENT.id} failed`),
      );
      expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        stripePaymentIntentId: MOCK_PAYMENT_INTENT.id,
        amount: MOCK_PAYMENT_INTENT.amount / 100,
        currency: MOCK_PAYMENT_INTENT.currency,
        errorMessage: "Card declined",
      });
    });

    it("should skip notification when payment intent has no customer ID", async () => {
      const paymentIntentWithoutCustomer = {
        ...MOCK_PAYMENT_INTENT,
        customer: null,
      };
      const job = createMockJob(
        "payment_intent.payment_failed",
        paymentIntentWithoutCustomer as unknown as Record<string, any>,
      );

      await processor.process(job);

      expect(logger.warn).toHaveBeenCalledWith(
        `Payment intent ${MOCK_PAYMENT_INTENT.id} has no customer ID - skipping notification`,
      );
      expect(notificationService.sendPaymentFailedEmail).not.toHaveBeenCalled();
    });

    it("should handle notification failure gracefully for payment_intent.payment_failed", async () => {
      const failedPaymentIntent = {
        ...MOCK_PAYMENT_INTENT,
        last_payment_error: { message: "Card declined" },
      };
      const job = createMockJob("payment_intent.payment_failed", failedPaymentIntent as unknown as Record<string, any>);
      notificationService.sendPaymentFailedEmail.mockRejectedValue(new Error("Email failed"));

      await processor.process(job);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          `Failed to send payment failure notification for payment intent ${MOCK_PAYMENT_INTENT.id}`,
        ),
      );
      // Should still complete successfully
      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "completed",
        processedAt: expect.any(Date),
      });
    });
  });

  describe("Unhandled Events", () => {
    it("should log debug message for unhandled event types", async () => {
      const job = createMockJob("unknown.event.type", { id: "unknown_123" });

      await processor.process(job);

      expect(logger.debug).toHaveBeenCalledWith("Unhandled webhook event type: unknown.event.type");
      expect(stripeWebhookEventRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_DATA.webhookEventId,
        status: "completed",
        processedAt: expect.any(Date),
      });
    });
  });

  describe("Worker Events", () => {
    it("should log debug message on job active", () => {
      const job = createMockJob("customer.subscription.created", {});

      processor.onActive(job);

      expect(logger.debug).toHaveBeenCalledWith(
        `Processing webhook ${job.data.eventType} (ID: ${job.data.stripeEventId})`,
      );
    });

    it("should log error message on job failed", () => {
      const job = createMockJob("customer.subscription.created", {});
      (job as any).failedReason = "Connection timeout";

      processor.onError(job);

      expect(logger.error).toHaveBeenCalledWith(
        `Error processing webhook ${job.data.eventType} (ID: ${job.data.stripeEventId}). Reason: Connection timeout`,
      );
    });

    it("should log debug message on job completed", () => {
      const job = createMockJob("customer.subscription.created", {});

      processor.onCompleted(job);

      expect(logger.debug).toHaveBeenCalledWith(
        `Completed webhook ${job.data.eventType} (ID: ${job.data.stripeEventId})`,
      );
    });
  });
});
