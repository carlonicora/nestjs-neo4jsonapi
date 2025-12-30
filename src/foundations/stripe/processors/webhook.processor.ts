import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import Stripe from "stripe";
import { AppLoggingService } from "../../../core/logging";
import { WebhookEventRepository } from "../repositories/webhook-event.repository";
import { StripeSubscriptionAdminService } from "../../stripe-subscription/services/stripe-subscription-admin.service";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { InvoiceRepository } from "../repositories/invoice.repository";
import { NotificationService } from "../services/notification.service";

export interface WebhookJobData {
  webhookEventId: string;
  stripeEventId: string;
  eventType: string;
  payload: Record<string, any>;
}

@Processor(`${process.env.QUEUE}_billing_webhook`, { concurrency: 5, lockDuration: 1000 * 60 })
export class WebhookProcessor extends WorkerHost {
  constructor(
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly subscriptionService: StripeSubscriptionAdminService,
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly subscriptionRepository: StripeSubscriptionRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly notificationService: NotificationService,
    private readonly logger: AppLoggingService,
  ) {
    super();
  }

  @OnWorkerEvent("active")
  onActive(job: Job<WebhookJobData>) {
    this.logger.debug(`Processing webhook ${job.data.eventType} (ID: ${job.data.stripeEventId})`);
  }

  @OnWorkerEvent("failed")
  onError(job: Job<WebhookJobData>) {
    this.logger.error(
      `Error processing webhook ${job.data.eventType} (ID: ${job.data.stripeEventId}). Reason: ${job.failedReason}`,
    );
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<WebhookJobData>) {
    this.logger.debug(`Completed webhook ${job.data.eventType} (ID: ${job.data.stripeEventId})`);
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId, eventType, payload } = job.data;

    try {
      await this.webhookEventRepository.updateStatus({
        id: webhookEventId,
        status: "processing",
      });

      await this.handleEvent(eventType, payload);

      await this.webhookEventRepository.updateStatus({
        id: webhookEventId,
        status: "completed",
        processedAt: new Date(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to process webhook ${eventType}: ${errorMessage}`);

      await this.webhookEventRepository.updateStatus({
        id: webhookEventId,
        status: "failed",
        error: errorMessage,
        incrementRetryCount: true,
      });

      throw error;
    }
  }

  private async handleEvent(eventType: string, payload: Record<string, any>): Promise<void> {
    switch (eventType) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await this.handleSubscriptionEvent(payload as Stripe.Subscription);
        break;

      case "invoice.paid":
      case "invoice.payment_failed":
        await this.handleInvoiceEvent(eventType, payload as Stripe.Invoice);
        break;

      case "customer.updated":
      case "customer.deleted":
        await this.handleCustomerEvent(eventType, payload as Stripe.Customer);
        break;

      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
        await this.handlePaymentIntentEvent(eventType, payload as Stripe.PaymentIntent);
        break;

      default:
        this.logger.debug(`Unhandled webhook event type: ${eventType}`);
    }
  }

  private async handleSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
    await this.subscriptionService.syncSubscriptionFromStripe({
      stripeSubscriptionId: subscription.id,
    });
  }

  private async handleInvoiceEvent(eventType: string, invoice: Stripe.Invoice): Promise<void> {
    const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

    if (!stripeCustomerId) {
      this.logger.warn(`Invoice ${invoice.id} has no customer ID`);
      return;
    }

    if (eventType === "invoice.payment_failed") {
      this.logger.warn(`Payment failed for invoice ${invoice.id} (customer: ${stripeCustomerId})`);

      // Find the invoice in our database
      const localInvoice = await this.invoiceRepository.findByStripeInvoiceId({
        stripeInvoiceId: invoice.id,
      });

      if (localInvoice) {
        // Update invoice status to failed and increment attempt count
        await this.invoiceRepository.updateByStripeInvoiceId({
          stripeInvoiceId: invoice.id,
          status: "uncollectible",
          attemptCount: invoice.attempt_count ?? 0,
          attempted: true,
        });

        // Send payment failure notification
        try {
          await this.notificationService.sendPaymentFailedEmail({
            stripeCustomerId,
            stripeInvoiceId: invoice.id,
            amount: invoice.amount_due / 100, // Convert cents to dollars
            currency: invoice.currency,
            errorMessage: invoice.last_finalization_error?.message,
          });
        } catch (error) {
          this.logger.error(
            `Failed to send payment failure notification for invoice ${invoice.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          // Don't throw - we don't want to fail the webhook processing just because email failed
        }
      } else {
        this.logger.warn(`Invoice ${invoice.id} not found in local database - skipping notification`);
      }
    }

    // In Stripe v20, subscription is nested under parent.subscription_details
    const subscriptionDetails = invoice.parent?.subscription_details;
    if (eventType === "invoice.paid" && subscriptionDetails?.subscription) {
      const subscriptionId =
        typeof subscriptionDetails.subscription === "string"
          ? subscriptionDetails.subscription
          : subscriptionDetails.subscription.id;
      await this.subscriptionService.syncSubscriptionFromStripe({
        stripeSubscriptionId: subscriptionId,
      });
    }
  }

  private async handleCustomerEvent(
    eventType: string,
    customer: Stripe.Customer | Stripe.DeletedCustomer,
  ): Promise<void> {
    if (eventType === "customer.deleted") {
      this.logger.warn(`Customer ${customer.id} was deleted in Stripe`);

      // Cancel all active subscriptions for this customer
      const canceledCount = await this.subscriptionRepository.cancelAllByStripeCustomerId({
        stripeCustomerId: customer.id,
      });

      this.logger.log(`Canceled ${canceledCount} subscription(s) for deleted customer ${customer.id}`);

      // Note: We keep the BillingCustomer record for historical/accounting purposes
      // The customer record remains in the database with all their billing history
    }

    if (eventType === "customer.updated" && "email" in customer) {
      await this.billingCustomerRepository.updateByStripeCustomerId({
        stripeCustomerId: customer.id,
        email: customer.email || undefined,
        name: customer.name || undefined,
      });
    }
  }

  private async handlePaymentIntentEvent(eventType: string, paymentIntent: Stripe.PaymentIntent): Promise<void> {
    if (eventType === "payment_intent.payment_failed") {
      this.logger.warn(`Payment intent ${paymentIntent.id} failed: ${paymentIntent.last_payment_error?.message}`);

      const stripeCustomerId =
        typeof paymentIntent.customer === "string" ? paymentIntent.customer : paymentIntent.customer?.id;

      if (!stripeCustomerId) {
        this.logger.warn(`Payment intent ${paymentIntent.id} has no customer ID - skipping notification`);
        return;
      }

      // Note: PaymentIntent doesn't directly expose invoice ID in all cases
      // We'll send a generic payment failure notification
      try {
        await this.notificationService.sendPaymentFailedEmail({
          stripeCustomerId,
          stripePaymentIntentId: paymentIntent.id,
          amount: paymentIntent.amount / 100, // Convert cents to dollars
          currency: paymentIntent.currency,
          errorMessage: paymentIntent.last_payment_error?.message,
        });
      } catch (error) {
        this.logger.error(
          `Failed to send payment failure notification for payment intent ${paymentIntent.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  }
}
