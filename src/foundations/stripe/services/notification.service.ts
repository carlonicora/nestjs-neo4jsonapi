import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { AppLoggingService } from "../../../core/logging";
import { QueueId } from "../../../config/enums/queue.id";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";
import { StripeInvoiceRepository } from "../../stripe-invoice/repositories/stripe-invoice.repository";

export interface PaymentFailureNotificationParams {
  stripeCustomerId: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  errorMessage?: string;
  amount?: number;
  currency?: string;
}

/**
 * NotificationService
 *
 * Handles sending notifications for billing events (payment failures, subscription changes, etc.)
 * Uses BullMQ to queue email notifications for non-blocking webhook processing.
 *
 * Key Features:
 * - Queue payment failure notifications via BullMQ
 * - Queue subscription status change notifications
 * - Non-blocking notification processing to prevent webhook delays
 * - Automatic retry logic with exponential backoff
 * - Enriches notifications with customer and invoice data
 *
 * All notifications are queued asynchronously to ensure webhook handlers remain fast and responsive.
 *
 * @example
 * ```typescript
 * // Called from webhook handler
 * await notificationService.sendPaymentFailedEmail({
 *   stripeCustomerId: 'cus_123',
 *   stripeInvoiceId: 'in_456',
 *   errorMessage: 'Card declined',
 *   amount: 2999,
 *   currency: 'usd'
 * });
 * ```
 */
@Injectable()
export class NotificationService {
  constructor(
    @InjectQueue(QueueId.EMAIL) private readonly emailQueue: Queue,
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly stripeInvoiceRepository: StripeInvoiceRepository,
    private readonly logger: AppLoggingService,
  ) {}

  /**
   * Send payment failure notification email
   *
   * Queues an email notification for a failed payment. Retrieves billing customer and invoice
   * details from the database to enrich the notification with context. Uses BullMQ for reliable,
   * asynchronous delivery with automatic retry logic.
   *
   * @param params - Payment failure details
   * @param params.stripeCustomerId - Stripe customer ID
   * @param params.stripeInvoiceId - Optional Stripe invoice ID
   * @param params.stripePaymentIntentId - Optional Stripe payment intent ID
   * @param params.errorMessage - Optional error message describing the failure
   * @param params.amount - Optional payment amount in smallest currency unit
   * @param params.currency - Optional currency code (e.g., 'usd')
   * @returns Promise that resolves when email is queued (not sent)
   *
   * @example
   * ```typescript
   * await notificationService.sendPaymentFailedEmail({
   *   stripeCustomerId: 'cus_123',
   *   stripeInvoiceId: 'in_456',
   *   errorMessage: 'Your card was declined',
   *   amount: 2999,
   *   currency: 'usd'
   * });
   * ```
   */
  async sendPaymentFailedEmail(params: PaymentFailureNotificationParams): Promise<void> {
    const { stripeCustomerId, stripeInvoiceId, stripePaymentIntentId, errorMessage, amount, currency } = params;

    try {
      // Retrieve billing customer from Neo4j
      const billingCustomer = await this.billingCustomerRepository.findByStripeCustomerId({ stripeCustomerId });

      if (!billingCustomer) {
        this.logger.warn(`Cannot send payment failure notification: Customer ${stripeCustomerId} not found in Neo4j`);
        return;
      }

      // Get invoice details if available
      let invoiceDetails = null;
      if (stripeInvoiceId) {
        invoiceDetails = await this.stripeInvoiceRepository.findByStripeInvoiceId({ stripeInvoiceId });
      }

      // Queue email notification (non-blocking)
      await this.emailQueue.add(
        "billing-notification",
        {
          jobType: "payment-failure" as const,
          payload: {
            to: billingCustomer.email,
            customerName: billingCustomer.name || "Customer",
            stripeCustomerId,
            stripeInvoiceId,
            stripePaymentIntentId,
            errorMessage: errorMessage || "Payment failed",
            amount,
            currency: currency || "usd",
            invoiceUrl: invoiceDetails?.stripeHostedInvoiceUrl,
            invoiceNumber: invoiceDetails?.stripeInvoiceNumber || undefined,
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

      this.logger.log(
        `Queued payment failure notification for customer ${stripeCustomerId}${stripeInvoiceId ? ` (invoice: ${stripeInvoiceId})` : ""}`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to queue payment failure notification for ${stripeCustomerId}: ${errorMsg}`);
      // Don't throw - notification failure shouldn't block webhook processing
    }
  }

  /**
   * Send subscription status change notification
   *
   * Queues an email notification when a subscription status changes. Retrieves billing customer
   * details from the database to personalize the notification. Uses BullMQ for reliable delivery.
   *
   * @param stripeCustomerId - Stripe customer ID
   * @param status - New subscription status (e.g., 'active', 'canceled', 'past_due')
   * @param subscriptionId - Stripe subscription ID
   * @returns Promise that resolves when email is queued (not sent)
   *
   * @example
   * ```typescript
   * await notificationService.sendSubscriptionStatusChangeEmail(
   *   'cus_123',
   *   'canceled',
   *   'sub_456'
   * );
   * ```
   */
  async sendSubscriptionStatusChangeEmail(
    stripeCustomerId: string,
    status: string,
    subscriptionId: string,
  ): Promise<void> {
    try {
      const billingCustomer = await this.billingCustomerRepository.findByStripeCustomerId({ stripeCustomerId });

      if (!billingCustomer) {
        this.logger.warn(`Cannot send subscription notification: Customer ${stripeCustomerId} not found in Neo4j`);
        return;
      }

      await this.emailQueue.add(
        "billing-notification",
        {
          jobType: "subscription-status-change" as const,
          payload: {
            to: billingCustomer.email,
            customerName: billingCustomer.name || "Customer",
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

      this.logger.log(`Queued subscription status change notification for customer ${stripeCustomerId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to queue subscription notification for ${stripeCustomerId}: ${errorMsg}`);
    }
  }
}
