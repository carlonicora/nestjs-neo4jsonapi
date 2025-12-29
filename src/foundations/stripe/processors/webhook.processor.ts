import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import Stripe from "stripe";
import { AppLoggingService } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookEventRepository } from "../repositories/webhook-event.repository";
import { SubscriptionService } from "../services/subscription.service";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";

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
    private readonly subscriptionService: SubscriptionService,
    private readonly billingCustomerRepository: BillingCustomerRepository,
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
      // TODO: Trigger payment failure notification
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
      // TODO: Handle customer deletion
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
      // TODO: Trigger payment failure notification
    }
  }
}
