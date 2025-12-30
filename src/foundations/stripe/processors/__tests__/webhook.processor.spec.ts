// Set environment variable BEFORE any imports
process.env.QUEUE = "test";

// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the StripeModule to prevent reflection metadata errors
jest.mock("../../stripe.module", () => ({
  StripeModule: class MockStripeModule {},
}));

// Mock the barrel export to provide the imports that the processor needs
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
import { Job } from "bullmq";
import Stripe from "stripe";
import { WebhookProcessor, WebhookJobData } from "../webhook.processor";
import { WebhookEventRepository } from "../../repositories/webhook-event.repository";
import { StripeSubscriptionAdminService } from "../../../stripe-subscription/services/stripe-subscription-admin.service";
import { BillingCustomerRepository } from "../../repositories/billing-customer.repository";
import { StripeSubscriptionRepository } from "../../../stripe-subscription/repositories/stripe-subscription.repository";
import { InvoiceRepository } from "../../repositories/invoice.repository";
import { NotificationService } from "../../services/notification.service";
import { AppLoggingService } from "../../../../core/logging";

describe("WebhookProcessor", () => {
  let processor: WebhookProcessor;
  let webhookEventRepository: jest.Mocked<WebhookEventRepository>;
  let subscriptionService: jest.Mocked<StripeSubscriptionAdminService>;
  let billingCustomerRepository: jest.Mocked<BillingCustomerRepository>;
  let subscriptionRepository: jest.Mocked<StripeSubscriptionRepository>;
  let invoiceRepository: jest.Mocked<InvoiceRepository>;
  let notificationService: jest.Mocked<NotificationService>;
  let logger: jest.Mocked<AppLoggingService>;

  // Test data constants
  const TEST_IDS = {
    webhookEventId: "webhook_event_123",
    stripeEventId: "evt_test123",
    customerId: "cus_test456",
    subscriptionId: "sub_test789",
    invoiceId: "in_test101",
    paymentIntentId: "pi_test202",
  };

  const createMockJob = (eventType: string, payload: Record<string, any>): Job<WebhookJobData> => {
    return {
      data: {
        webhookEventId: TEST_IDS.webhookEventId,
        stripeEventId: TEST_IDS.stripeEventId,
        eventType,
        payload,
      },
      failedReason: "Test failure reason",
    } as Job<WebhookJobData>;
  };

  beforeEach(async () => {
    const mockWebhookEventRepository = {
      updateStatus: jest.fn(),
    };

    const mockStripeSubscriptionAdminService = {
      syncSubscriptionFromStripe: jest.fn(),
    };

    const mockBillingCustomerRepository = {
      updateByStripeCustomerId: jest.fn(),
    };

    const mockStripeSubscriptionRepository = {
      cancelAllByStripeCustomerId: jest.fn(),
    };

    const mockInvoiceRepository = {
      findByStripeInvoiceId: jest.fn(),
      updateByStripeInvoiceId: jest.fn(),
    };

    const mockNotificationService = {
      sendPaymentFailedEmail: jest.fn(),
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
        WebhookProcessor,
        {
          provide: WebhookEventRepository,
          useValue: mockWebhookEventRepository,
        },
        {
          provide: StripeSubscriptionAdminService,
          useValue: mockStripeSubscriptionAdminService,
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
          provide: InvoiceRepository,
          useValue: mockInvoiceRepository,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: AppLoggingService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    processor = module.get<WebhookProcessor>(WebhookProcessor);
    webhookEventRepository = module.get(WebhookEventRepository);
    subscriptionService = module.get(StripeSubscriptionAdminService);
    billingCustomerRepository = module.get(BillingCustomerRepository);
    subscriptionRepository = module.get(StripeSubscriptionRepository);
    invoiceRepository = module.get(InvoiceRepository);
    notificationService = module.get(NotificationService);
    logger = module.get(AppLoggingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Processor Setup", () => {
    it("should extend WorkerHost", () => {
      expect(processor).toBeDefined();
      expect(processor.process).toBeDefined();
    });

    it("should have correct processor configuration", () => {
      const expectedQueueName = `${process.env.QUEUE}_billing_webhook`;
      expect(expectedQueueName).toBe("test_billing_webhook");
    });
  });

  describe("Worker Event Handlers", () => {
    describe("onActive", () => {
      it("should log debug message when job becomes active", () => {
        const job = createMockJob("customer.subscription.created", {});

        processor.onActive(job);

        expect(logger.debug).toHaveBeenCalledWith(
          `Processing webhook customer.subscription.created (ID: ${TEST_IDS.stripeEventId})`,
        );
      });

      it("should include event type and stripe event ID in log", () => {
        const job = createMockJob("invoice.paid", {});

        processor.onActive(job);

        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("invoice.paid"));
        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(TEST_IDS.stripeEventId));
      });
    });

    describe("onError", () => {
      it("should log error message when job fails", () => {
        const job = createMockJob("customer.subscription.updated", {});

        processor.onError(job);

        expect(logger.error).toHaveBeenCalledWith(
          `Error processing webhook customer.subscription.updated (ID: ${TEST_IDS.stripeEventId}). Reason: Test failure reason`,
        );
      });

      it("should include failure reason in log", () => {
        const job = createMockJob("invoice.payment_failed", {});

        processor.onError(job);

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Test failure reason"));
      });
    });

    describe("onCompleted", () => {
      it("should log debug message when job completes", () => {
        const job = createMockJob("customer.deleted", {});

        processor.onCompleted(job);

        expect(logger.debug).toHaveBeenCalledWith(`Completed webhook customer.deleted (ID: ${TEST_IDS.stripeEventId})`);
      });

      it("should include event type and stripe event ID in log", () => {
        const job = createMockJob("payment_intent.succeeded", {});

        processor.onCompleted(job);

        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("payment_intent.succeeded"));
        expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(TEST_IDS.stripeEventId));
      });
    });
  });

  describe("Main process() method", () => {
    describe("Success Path", () => {
      it("should update status to processing before handling event", async () => {
        const job = createMockJob("customer.subscription.created", {
          id: TEST_IDS.subscriptionId,
        });

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        await processor.process(job);

        expect(webhookEventRepository.updateStatus).toHaveBeenNthCalledWith(1, {
          id: TEST_IDS.webhookEventId,
          status: "processing",
        });
      });

      it("should call handleEvent with event type and payload", async () => {
        const payload = { id: TEST_IDS.subscriptionId };
        const job = createMockJob("customer.subscription.created", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        const handleEventSpy = jest.spyOn(processor as any, "handleEvent");

        await processor.process(job);

        expect(handleEventSpy).toHaveBeenCalledWith("customer.subscription.created", payload);
      });

      it("should update status to completed with processedAt on success", async () => {
        const job = createMockJob("customer.subscription.created", {
          id: TEST_IDS.subscriptionId,
        });

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        const beforeProcess = new Date();
        await processor.process(job);
        const afterProcess = new Date();

        expect(webhookEventRepository.updateStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            id: TEST_IDS.webhookEventId,
            status: "completed",
            processedAt: expect.any(Date),
          }),
        );

        const processedAt = (webhookEventRepository.updateStatus.mock.calls[1][0] as any).processedAt;
        expect(processedAt.getTime()).toBeGreaterThanOrEqual(beforeProcess.getTime());
        expect(processedAt.getTime()).toBeLessThanOrEqual(afterProcess.getTime());
      });

      it("should call updateStatus twice: processing and completed", async () => {
        const job = createMockJob("customer.subscription.created", {
          id: TEST_IDS.subscriptionId,
        });

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        await processor.process(job);

        expect(webhookEventRepository.updateStatus).toHaveBeenCalledTimes(2);
      });
    });

    describe("Error Handling", () => {
      it("should log error message on failure", async () => {
        const job = createMockJob("customer.subscription.created", {
          id: TEST_IDS.subscriptionId,
        });
        const error = new Error("Subscription sync failed");

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockRejectedValue(error);

        await expect(processor.process(job)).rejects.toThrow("Subscription sync failed");

        expect(logger.error).toHaveBeenCalledWith(
          "Failed to process webhook customer.subscription.created: Subscription sync failed",
        );
      });

      it("should update status to failed with error message on failure", async () => {
        const job = createMockJob("customer.subscription.created", {
          id: TEST_IDS.subscriptionId,
        });
        const error = new Error("Database connection lost");

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockRejectedValue(error);

        await expect(processor.process(job)).rejects.toThrow("Database connection lost");

        expect(webhookEventRepository.updateStatus).toHaveBeenCalledWith({
          id: TEST_IDS.webhookEventId,
          status: "failed",
          error: "Database connection lost",
          incrementRetryCount: true,
        });
      });

      it("should rethrow error after updating status", async () => {
        const job = createMockJob("customer.subscription.created", {
          id: TEST_IDS.subscriptionId,
        });
        const error = new Error("Critical error");

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockRejectedValue(error);

        await expect(processor.process(job)).rejects.toThrow("Critical error");
      });

      it("should handle non-Error objects as 'Unknown error'", async () => {
        const job = createMockJob("customer.subscription.created", {
          id: TEST_IDS.subscriptionId,
        });

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockRejectedValue("String error");

        await expect(processor.process(job)).rejects.toEqual("String error");

        expect(webhookEventRepository.updateStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            error: "Unknown error",
          }),
        );
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining("Failed to process webhook customer.subscription.created: Unknown error"),
        );
      });

      it("should increment retry count on failure", async () => {
        const job = createMockJob("customer.subscription.created", {
          id: TEST_IDS.subscriptionId,
        });
        const error = new Error("Temporary failure");

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockRejectedValue(error);

        await expect(processor.process(job)).rejects.toThrow("Temporary failure");

        expect(webhookEventRepository.updateStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            incrementRetryCount: true,
          }),
        );
      });
    });
  });

  describe("handleEvent() - Event Routing", () => {
    describe("Subscription Events", () => {
      it("should route customer.subscription.created to handleSubscriptionEvent", async () => {
        const payload = { id: TEST_IDS.subscriptionId } as Stripe.Subscription;
        const job = createMockJob("customer.subscription.created", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        await processor.process(job);

        expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
          stripeSubscriptionId: TEST_IDS.subscriptionId,
        });
      });

      it("should route customer.subscription.updated to handleSubscriptionEvent", async () => {
        const payload = { id: TEST_IDS.subscriptionId } as Stripe.Subscription;
        const job = createMockJob("customer.subscription.updated", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        await processor.process(job);

        expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
          stripeSubscriptionId: TEST_IDS.subscriptionId,
        });
      });

      it("should route customer.subscription.deleted to handleSubscriptionEvent", async () => {
        const payload = { id: TEST_IDS.subscriptionId } as Stripe.Subscription;
        const job = createMockJob("customer.subscription.deleted", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        await processor.process(job);

        expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
          stripeSubscriptionId: TEST_IDS.subscriptionId,
        });
      });
    });

    describe("Invoice Events", () => {
      it("should route invoice.paid to handleInvoiceEvent", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.paid", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(webhookEventRepository.updateStatus).toHaveBeenCalledWith(
          expect.objectContaining({ status: "completed" }),
        );
      });

      it("should route invoice.payment_failed to handleInvoiceEvent", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(invoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
          stripeInvoiceId: TEST_IDS.invoiceId,
        });
      });
    });

    describe("Customer Events", () => {
      it("should route customer.updated to handleCustomerEvent", async () => {
        const payload = {
          id: TEST_IDS.customerId,
          email: "updated@example.com",
          name: "Updated Name",
        } as Stripe.Customer;
        const job = createMockJob("customer.updated", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue({} as any);

        await processor.process(job);

        expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.customerId,
          email: "updated@example.com",
          name: "Updated Name",
        });
      });

      it("should route customer.deleted to handleCustomerEvent", async () => {
        const payload = { id: TEST_IDS.customerId } as Stripe.DeletedCustomer;
        const job = createMockJob("customer.deleted", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionRepository.cancelAllByStripeCustomerId.mockResolvedValue(2);

        await processor.process(job);

        expect(subscriptionRepository.cancelAllByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.customerId,
        });
      });
    });

    describe("Payment Intent Events", () => {
      it("should route payment_intent.succeeded to handlePaymentIntentEvent", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: TEST_IDS.customerId,
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.succeeded", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(webhookEventRepository.updateStatus).toHaveBeenCalledWith(
          expect.objectContaining({ status: "completed" }),
        );
      });

      it("should route payment_intent.payment_failed to handlePaymentIntentEvent", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: TEST_IDS.customerId,
          amount: 5000,
          currency: "usd",
          last_payment_error: {
            message: "Card declined",
          },
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalled();
      });
    });

    describe("Unhandled Events", () => {
      it("should log debug message for unhandled event types", async () => {
        const payload = { id: "some_id" };
        const job = createMockJob("charge.succeeded", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(logger.debug).toHaveBeenCalledWith("Unhandled webhook event type: charge.succeeded");
      });

      it("should not throw for unhandled event types", async () => {
        const payload = { id: "some_id" };
        const job = createMockJob("unknown.event.type", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await expect(processor.process(job)).resolves.not.toThrow();
      });

      it("should complete successfully for unhandled events", async () => {
        const payload = { id: "some_id" };
        const job = createMockJob("product.created", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(webhookEventRepository.updateStatus).toHaveBeenCalledWith(
          expect.objectContaining({ status: "completed" }),
        );
      });
    });
  });

  describe("handleSubscriptionEvent()", () => {
    it("should delegate to subscriptionService.syncSubscriptionFromStripe", async () => {
      const payload = { id: TEST_IDS.subscriptionId } as Stripe.Subscription;
      const job = createMockJob("customer.subscription.created", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
        stripeSubscriptionId: TEST_IDS.subscriptionId,
      });
    });

    it("should pass subscription ID correctly", async () => {
      const payload = { id: "sub_specific_123" } as Stripe.Subscription;
      const job = createMockJob("customer.subscription.updated", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
        stripeSubscriptionId: "sub_specific_123",
      });
    });
  });

  describe("handleInvoiceEvent()", () => {
    describe("Customer Extraction", () => {
      it("should extract customer as string", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            stripeCustomerId: TEST_IDS.customerId,
          }),
        );
      });

      it("should extract customer from object", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: { id: TEST_IDS.customerId, email: "test@example.com" } as Stripe.Customer,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            stripeCustomerId: TEST_IDS.customerId,
          }),
        );
      });

      it("should return early with warning if no customerId", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: null,
          amount_due: 5000,
          currency: "usd",
        } as any;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(logger.warn).toHaveBeenCalledWith(`Invoice ${TEST_IDS.invoiceId} has no customer ID`);
        expect(invoiceRepository.findByStripeInvoiceId).not.toHaveBeenCalled();
        expect(notificationService.sendPaymentFailedEmail).not.toHaveBeenCalled();
      });
    });

    describe("invoice.payment_failed", () => {
      it("should log warning for payment failure", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(logger.warn).toHaveBeenCalledWith(
          `Payment failed for invoice ${TEST_IDS.invoiceId} (customer: ${TEST_IDS.customerId})`,
        );
      });

      it("should find local invoice by stripe invoice ID", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(invoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
          stripeInvoiceId: TEST_IDS.invoiceId,
        });
      });

      it("should update invoice status to uncollectible", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 3,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(invoiceRepository.updateByStripeInvoiceId).toHaveBeenCalledWith({
          stripeInvoiceId: TEST_IDS.invoiceId,
          status: "uncollectible",
          attemptCount: 3,
          attempted: true,
        });
      });

      it("should use default attemptCount of 0 when null", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: null,
        } as any;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(invoiceRepository.updateByStripeInvoiceId).toHaveBeenCalledWith(
          expect.objectContaining({
            attemptCount: 0,
          }),
        );
      });

      it("should send payment failure notification with amount converted from cents to dollars", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000, // 5000 cents
          currency: "usd",
          attempt_count: 1,
          last_finalization_error: {
            message: "Card declined",
          },
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.customerId,
          stripeInvoiceId: TEST_IDS.invoiceId,
          amount: 50, // Divided by 100
          currency: "usd",
          errorMessage: "Card declined",
        });
      });

      it("should catch and log notification errors without throwing", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);
        const notificationError = new Error("Email service unavailable");

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockRejectedValue(notificationError);

        await expect(processor.process(job)).resolves.not.toThrow();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to send payment failure notification for invoice ${TEST_IDS.invoiceId}: Email service unavailable`,
        );
      });

      it("should handle unknown notification error types", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
          id: "invoice_db_123",
          stripeInvoiceId: TEST_IDS.invoiceId,
        } as any);
        invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockRejectedValue("String error");

        await expect(processor.process(job)).resolves.not.toThrow();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to send payment failure notification for invoice ${TEST_IDS.invoiceId}: Unknown error`,
        );
      });

      it("should warn if invoice not found locally", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
        } as Stripe.Invoice;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);

        await processor.process(job);

        expect(logger.warn).toHaveBeenCalledWith(
          `Invoice ${TEST_IDS.invoiceId} not found in local database - skipping notification`,
        );
        expect(invoiceRepository.updateByStripeInvoiceId).not.toHaveBeenCalled();
        expect(notificationService.sendPaymentFailedEmail).not.toHaveBeenCalled();
      });
    });

    describe("invoice.paid with subscription", () => {
      it("should extract subscription from parent.subscription_details as string", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          parent: {
            subscription_details: {
              subscription: TEST_IDS.subscriptionId,
            },
          },
        } as any;
        const job = createMockJob("invoice.paid", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        await processor.process(job);

        expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
          stripeSubscriptionId: TEST_IDS.subscriptionId,
        });
      });

      it("should extract subscription from parent.subscription_details as object", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          parent: {
            subscription_details: {
              subscription: { id: TEST_IDS.subscriptionId } as any,
            },
          },
        } as any;
        const job = createMockJob("invoice.paid", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

        await processor.process(job);

        expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
          stripeSubscriptionId: TEST_IDS.subscriptionId,
        });
      });

      it("should not sync subscription if parent.subscription_details.subscription is null", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          parent: {
            subscription_details: {
              subscription: null,
            },
          },
        } as any;
        const job = createMockJob("invoice.paid", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(subscriptionService.syncSubscriptionFromStripe).not.toHaveBeenCalled();
      });

      it("should not sync subscription if parent is null", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          parent: null,
        } as any;
        const job = createMockJob("invoice.paid", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(subscriptionService.syncSubscriptionFromStripe).not.toHaveBeenCalled();
      });

      it("should only sync subscription for invoice.paid, not invoice.payment_failed", async () => {
        const payload = {
          id: TEST_IDS.invoiceId,
          customer: TEST_IDS.customerId,
          amount_due: 5000,
          currency: "usd",
          attempt_count: 1,
          parent: {
            subscription_details: {
              subscription: TEST_IDS.subscriptionId,
            },
          },
        } as any;
        const job = createMockJob("invoice.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        invoiceRepository.findByStripeInvoiceId.mockResolvedValue(null);

        await processor.process(job);

        expect(subscriptionService.syncSubscriptionFromStripe).not.toHaveBeenCalled();
      });
    });
  });

  describe("handleCustomerEvent()", () => {
    describe("customer.deleted", () => {
      it("should log warning when customer deleted", async () => {
        const payload = { id: TEST_IDS.customerId } as Stripe.DeletedCustomer;
        const job = createMockJob("customer.deleted", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionRepository.cancelAllByStripeCustomerId.mockResolvedValue(0);

        await processor.process(job);

        expect(logger.warn).toHaveBeenCalledWith(`Customer ${TEST_IDS.customerId} was deleted in Stripe`);
      });

      it("should cancel all active subscriptions for deleted customer", async () => {
        const payload = { id: TEST_IDS.customerId } as Stripe.DeletedCustomer;
        const job = createMockJob("customer.deleted", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionRepository.cancelAllByStripeCustomerId.mockResolvedValue(3);

        await processor.process(job);

        expect(subscriptionRepository.cancelAllByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.customerId,
        });
      });

      it("should log canceled count", async () => {
        const payload = { id: TEST_IDS.customerId } as Stripe.DeletedCustomer;
        const job = createMockJob("customer.deleted", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionRepository.cancelAllByStripeCustomerId.mockResolvedValue(5);

        await processor.process(job);

        expect(logger.log).toHaveBeenCalledWith(
          `Canceled 5 subscription(s) for deleted customer ${TEST_IDS.customerId}`,
        );
      });

      it("should handle zero canceled subscriptions", async () => {
        const payload = { id: TEST_IDS.customerId } as Stripe.DeletedCustomer;
        const job = createMockJob("customer.deleted", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionRepository.cancelAllByStripeCustomerId.mockResolvedValue(0);

        await processor.process(job);

        expect(logger.log).toHaveBeenCalledWith(
          `Canceled 0 subscription(s) for deleted customer ${TEST_IDS.customerId}`,
        );
      });
    });

    describe("customer.updated", () => {
      it("should update billing customer email and name", async () => {
        const payload = {
          id: TEST_IDS.customerId,
          email: "newemail@example.com",
          name: "New Name",
        } as Stripe.Customer;
        const job = createMockJob("customer.updated", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue({} as any);

        await processor.process(job);

        expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.customerId,
          email: "newemail@example.com",
          name: "New Name",
        });
      });

      it("should handle null email by passing undefined", async () => {
        const payload = {
          id: TEST_IDS.customerId,
          email: null,
          name: "Test Name",
        } as Stripe.Customer;
        const job = createMockJob("customer.updated", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue({} as any);

        await processor.process(job);

        expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.customerId,
          email: undefined,
          name: "Test Name",
        });
      });

      it("should handle null name by passing undefined", async () => {
        const payload = {
          id: TEST_IDS.customerId,
          email: "test@example.com",
          name: null,
        } as Stripe.Customer;
        const job = createMockJob("customer.updated", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        billingCustomerRepository.updateByStripeCustomerId.mockResolvedValue({} as any);

        await processor.process(job);

        expect(billingCustomerRepository.updateByStripeCustomerId).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.customerId,
          email: "test@example.com",
          name: undefined,
        });
      });

      it("should not update customer for deleted customer event", async () => {
        const payload = { id: TEST_IDS.customerId } as Stripe.DeletedCustomer;
        const job = createMockJob("customer.deleted", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        subscriptionRepository.cancelAllByStripeCustomerId.mockResolvedValue(0);

        await processor.process(job);

        expect(billingCustomerRepository.updateByStripeCustomerId).not.toHaveBeenCalled();
      });
    });
  });

  describe("handlePaymentIntentEvent()", () => {
    describe("payment_intent.payment_failed", () => {
      it("should log warning for payment intent failure", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: TEST_IDS.customerId,
          amount: 5000,
          currency: "usd",
          last_payment_error: {
            message: "Insufficient funds",
          },
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(logger.warn).toHaveBeenCalledWith(
          `Payment intent ${TEST_IDS.paymentIntentId} failed: Insufficient funds`,
        );
      });

      it("should extract customer as string", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: TEST_IDS.customerId,
          amount: 5000,
          currency: "usd",
          last_payment_error: {
            message: "Card declined",
          },
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            stripeCustomerId: TEST_IDS.customerId,
          }),
        );
      });

      it("should extract customer from object", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: { id: TEST_IDS.customerId, email: "test@example.com" } as Stripe.Customer,
          amount: 5000,
          currency: "usd",
          last_payment_error: {
            message: "Card declined",
          },
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            stripeCustomerId: TEST_IDS.customerId,
          }),
        );
      });

      it("should return early with warning if no customerId", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: null,
          amount: 5000,
          currency: "usd",
        } as any;
        const job = createMockJob("payment_intent.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(logger.warn).toHaveBeenCalledWith(
          `Payment intent ${TEST_IDS.paymentIntentId} has no customer ID - skipping notification`,
        );
        expect(notificationService.sendPaymentFailedEmail).not.toHaveBeenCalled();
      });

      it("should send payment failure notification with amount converted from cents to dollars", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: TEST_IDS.customerId,
          amount: 10000, // 10000 cents
          currency: "eur",
          last_payment_error: {
            message: "Card expired",
          },
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

        await processor.process(job);

        expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith({
          stripeCustomerId: TEST_IDS.customerId,
          stripePaymentIntentId: TEST_IDS.paymentIntentId,
          amount: 100, // Divided by 100
          currency: "eur",
          errorMessage: "Card expired",
        });
      });

      it("should catch and log notification errors without throwing", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: TEST_IDS.customerId,
          amount: 5000,
          currency: "usd",
          last_payment_error: {
            message: "Card declined",
          },
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.payment_failed", payload);
        const notificationError = new Error("Email queue full");

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockRejectedValue(notificationError);

        await expect(processor.process(job)).resolves.not.toThrow();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to send payment failure notification for payment intent ${TEST_IDS.paymentIntentId}: Email queue full`,
        );
      });

      it("should handle unknown notification error types", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: TEST_IDS.customerId,
          amount: 5000,
          currency: "usd",
          last_payment_error: {
            message: "Card declined",
          },
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.payment_failed", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);
        notificationService.sendPaymentFailedEmail.mockRejectedValue("String error");

        await expect(processor.process(job)).resolves.not.toThrow();

        expect(logger.error).toHaveBeenCalledWith(
          `Failed to send payment failure notification for payment intent ${TEST_IDS.paymentIntentId}: Unknown error`,
        );
      });
    });

    describe("payment_intent.succeeded", () => {
      it("should not send notification for succeeded payment intent", async () => {
        const payload = {
          id: TEST_IDS.paymentIntentId,
          customer: TEST_IDS.customerId,
          amount: 5000,
          currency: "usd",
        } as Stripe.PaymentIntent;
        const job = createMockJob("payment_intent.succeeded", payload);

        webhookEventRepository.updateStatus.mockResolvedValue({} as any);

        await processor.process(job);

        expect(notificationService.sendPaymentFailedEmail).not.toHaveBeenCalled();
      });
    });
  });

  describe("Cents to Dollars Conversion", () => {
    it("should convert invoice amount from cents to dollars (divide by 100)", async () => {
      const payload = {
        id: TEST_IDS.invoiceId,
        customer: TEST_IDS.customerId,
        amount_due: 12345, // 12345 cents = 123.45 dollars
        currency: "usd",
        attempt_count: 1,
      } as Stripe.Invoice;
      const job = createMockJob("invoice.payment_failed", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
        id: "invoice_db_123",
        stripeInvoiceId: TEST_IDS.invoiceId,
      } as any);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
      notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

      await processor.process(job);

      expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 123.45,
        }),
      );
    });

    it("should convert payment intent amount from cents to dollars (divide by 100)", async () => {
      const payload = {
        id: TEST_IDS.paymentIntentId,
        customer: TEST_IDS.customerId,
        amount: 99999, // 99999 cents = 999.99 dollars
        currency: "usd",
        last_payment_error: {
          message: "Card declined",
        },
      } as Stripe.PaymentIntent;
      const job = createMockJob("payment_intent.payment_failed", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

      await processor.process(job);

      expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 999.99,
        }),
      );
    });

    it("should handle zero amount conversion", async () => {
      const payload = {
        id: TEST_IDS.paymentIntentId,
        customer: TEST_IDS.customerId,
        amount: 0,
        currency: "usd",
        last_payment_error: {
          message: "Card declined",
        },
      } as Stripe.PaymentIntent;
      const job = createMockJob("payment_intent.payment_failed", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

      await processor.process(job);

      expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 0,
        }),
      );
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    it("should handle missing last_payment_error gracefully", async () => {
      const payload = {
        id: TEST_IDS.paymentIntentId,
        customer: TEST_IDS.customerId,
        amount: 5000,
        currency: "usd",
        last_payment_error: null,
      } as any;
      const job = createMockJob("payment_intent.payment_failed", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

      await processor.process(job);

      expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: undefined,
        }),
      );
    });

    it("should handle missing last_finalization_error gracefully", async () => {
      const payload = {
        id: TEST_IDS.invoiceId,
        customer: TEST_IDS.customerId,
        amount_due: 5000,
        currency: "usd",
        attempt_count: 1,
        last_finalization_error: null,
      } as any;
      const job = createMockJob("invoice.payment_failed", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
        id: "invoice_db_123",
        stripeInvoiceId: TEST_IDS.invoiceId,
      } as any);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
      notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

      await processor.process(job);

      expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: undefined,
        }),
      );
    });

    it("should process multiple events in sequence", async () => {
      const job1 = createMockJob("customer.subscription.created", {
        id: "sub_1",
      });
      const job2 = createMockJob("customer.subscription.updated", {
        id: "sub_2",
      });

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job1);
      await processor.process(job2);

      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledTimes(2);
      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenNthCalledWith(1, {
        stripeSubscriptionId: "sub_1",
      });
      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenNthCalledWith(2, {
        stripeSubscriptionId: "sub_2",
      });
    });

    it("should handle complex payload structures", async () => {
      const complexPayload = {
        id: TEST_IDS.subscriptionId,
        customer: TEST_IDS.customerId,
        items: {
          data: [
            {
              id: "si_123",
              price: {
                id: "price_123",
                product: "prod_123",
              },
            },
          ],
        },
        metadata: {
          custom_field: "value",
        },
      } as any;
      const job = createMockJob("customer.subscription.created", complexPayload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue({} as any);

      await processor.process(job);

      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
        stripeSubscriptionId: TEST_IDS.subscriptionId,
      });
    });
  });

  describe("Integration Tests", () => {
    it("should successfully process full invoice.payment_failed workflow", async () => {
      const payload = {
        id: TEST_IDS.invoiceId,
        customer: TEST_IDS.customerId,
        amount_due: 5000,
        currency: "usd",
        attempt_count: 2,
        last_finalization_error: {
          message: "Payment method declined",
        },
      } as Stripe.Invoice;
      const job = createMockJob("invoice.payment_failed", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      invoiceRepository.findByStripeInvoiceId.mockResolvedValue({
        id: "invoice_db_123",
        stripeInvoiceId: TEST_IDS.invoiceId,
      } as any);
      invoiceRepository.updateByStripeInvoiceId.mockResolvedValue({} as any);
      notificationService.sendPaymentFailedEmail.mockResolvedValue({} as any);

      await processor.process(job);

      expect(webhookEventRepository.updateStatus).toHaveBeenNthCalledWith(1, {
        id: TEST_IDS.webhookEventId,
        status: "processing",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        `Payment failed for invoice ${TEST_IDS.invoiceId} (customer: ${TEST_IDS.customerId})`,
      );
      expect(invoiceRepository.findByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: TEST_IDS.invoiceId,
      });
      expect(invoiceRepository.updateByStripeInvoiceId).toHaveBeenCalledWith({
        stripeInvoiceId: TEST_IDS.invoiceId,
        status: "uncollectible",
        attemptCount: 2,
        attempted: true,
      });
      expect(notificationService.sendPaymentFailedEmail).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
        stripeInvoiceId: TEST_IDS.invoiceId,
        amount: 50,
        currency: "usd",
        errorMessage: "Payment method declined",
      });
      expect(webhookEventRepository.updateStatus).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: TEST_IDS.webhookEventId,
          status: "completed",
        }),
      );
    });

    it("should successfully process full customer.deleted workflow", async () => {
      const payload = { id: TEST_IDS.customerId } as Stripe.DeletedCustomer;
      const job = createMockJob("customer.deleted", payload);

      webhookEventRepository.updateStatus.mockResolvedValue({} as any);
      subscriptionRepository.cancelAllByStripeCustomerId.mockResolvedValue(3);

      await processor.process(job);

      expect(webhookEventRepository.updateStatus).toHaveBeenNthCalledWith(1, {
        id: TEST_IDS.webhookEventId,
        status: "processing",
      });
      expect(logger.warn).toHaveBeenCalledWith(`Customer ${TEST_IDS.customerId} was deleted in Stripe`);
      expect(subscriptionRepository.cancelAllByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: TEST_IDS.customerId,
      });
      expect(logger.log).toHaveBeenCalledWith(`Canceled 3 subscription(s) for deleted customer ${TEST_IDS.customerId}`);
      expect(webhookEventRepository.updateStatus).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: TEST_IDS.webhookEventId,
          status: "completed",
        }),
      );
    });
  });
});
