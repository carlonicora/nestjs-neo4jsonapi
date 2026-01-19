import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { AppLoggingService } from "../../../core/logging";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeInvoiceRepository } from "../../stripe-invoice/repositories/stripe-invoice.repository";
import { UserRepository } from "../../user/repositories/user.repository";

export interface StripeWebhookPaymentFailureNotificationParams {
  stripeCustomerId: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  errorMessage?: string;
  amount?: number;
  currency?: string;
}

export interface StripeWebhookPaymentSuccessNotificationParams {
  stripeCustomerId: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  amount: number;
  currency: string;
  companyName?: string;
  isOneTimePurchase?: boolean;
}

export interface StripeWebhookTrialEndingNotificationParams {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  trialEndDate: Date;
}

export interface StripeWebhookTrialEndedNotificationParams {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  companyName: string;
  trialEndDate: Date;
}

/**
 * StripeWebhookNotificationService
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
 */
@Injectable()
export class StripeWebhookNotificationService {
  constructor(
    @InjectQueue(QueueId.EMAIL) private readonly emailQueue: Queue,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly stripeInvoiceRepository: StripeInvoiceRepository,
    private readonly userRepository: UserRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly cls: ClsService,
    private readonly logger: AppLoggingService,
  ) {}

  /**
   * Send payment failure notification email
   */
  async sendPaymentFailedEmail(params: StripeWebhookPaymentFailureNotificationParams): Promise<void> {
    const { stripeCustomerId, stripeInvoiceId, stripePaymentIntentId, errorMessage, amount, currency } = params;

    try {
      // Retrieve stripe customer from Neo4j
      const stripeCustomer = await this.stripeCustomerRepository.findByStripeCustomerId({ stripeCustomerId });

      if (!stripeCustomer) {
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
            to: stripeCustomer.email,
            customerName: stripeCustomer.name || "Customer",
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
   */
  async sendSubscriptionStatusChangeEmail(
    stripeCustomerId: string,
    status: string,
    subscriptionId: string,
  ): Promise<void> {
    try {
      const stripeCustomer = await this.stripeCustomerRepository.findByStripeCustomerId({ stripeCustomerId });

      if (!stripeCustomer) {
        this.logger.warn(`Cannot send subscription notification: Customer ${stripeCustomerId} not found in Neo4j`);
        return;
      }

      await this.emailQueue.add(
        "billing-notification",
        {
          jobType: "subscription-status-change" as const,
          payload: {
            to: stripeCustomer.email,
            customerName: stripeCustomer.name || "Customer",
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

  /**
   * Send payment success notification to company admins
   * Includes invoice link and thank you message
   */
  async sendPaymentSuccessToCompanyAdmins(params: StripeWebhookPaymentSuccessNotificationParams): Promise<void> {
    const { stripeCustomerId, stripeInvoiceId, stripePaymentIntentId, amount, currency, isOneTimePurchase } = params;

    try {
      // Run in CLS context since this may be called from a worker without HTTP context
      await this.cls.run(async () => {
        // Find all company admins for this Stripe customer
        const companyAdmins = await this.userRepository.findCompanyAdminsByStripeCustomerId({ stripeCustomerId });

        if (companyAdmins.length === 0) {
          this.logger.warn(`No company admins found for Stripe customer ${stripeCustomerId} - skipping notification`);
          return;
        }

        // Get invoice details if available
        let invoiceDetails = null;
        if (stripeInvoiceId) {
          invoiceDetails = await this.stripeInvoiceRepository.findByStripeInvoiceId({ stripeInvoiceId });
        }

        // Queue email for each company admin
        for (const admin of companyAdmins) {
          await this.emailQueue.add(
            "billing-notification",
            {
              jobType: "payment-success-customer" as const,
              payload: {
                to: admin.email,
                customerName: admin.name || "Customer",
                stripeCustomerId,
                stripeInvoiceId,
                stripePaymentIntentId,
                amount,
                currency: currency || "usd",
                invoiceUrl: invoiceDetails?.stripeHostedInvoiceUrl,
                invoiceNumber: invoiceDetails?.stripeInvoiceNumber || undefined,
                isOneTimePurchase: isOneTimePurchase || false,
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
        }

        this.logger.log(
          `Queued payment success notification for ${companyAdmins.length} company admin(s) (customer: ${stripeCustomerId})`,
        );
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to queue payment success notification for company admins: ${errorMsg}`);
      // Don't throw - notification failure shouldn't block webhook processing
    }
  }

  /**
   * Send payment success notification to platform administrators
   * Minimal details: company name and amount only
   */
  async sendPaymentSuccessToPlatformAdmins(params: StripeWebhookPaymentSuccessNotificationParams): Promise<void> {
    const { stripeCustomerId, amount, currency, companyName, isOneTimePurchase } = params;

    try {
      // Run in CLS context since this may be called from a worker without HTTP context
      await this.cls.run(async () => {
        // Find all platform administrators
        const platformAdmins = await this.userRepository.findPlatformAdministrators();

        if (platformAdmins.length === 0) {
          this.logger.warn("No platform administrators found - skipping admin notification");
          return;
        }

        // Resolve company name if not provided
        let resolvedCompanyName = companyName;
        if (!resolvedCompanyName) {
          const stripeCustomer = await this.stripeCustomerRepository.findByStripeCustomerId({ stripeCustomerId });
          if (stripeCustomer) {
            const company = await this.companyRepository.findByStripeCustomerId({
              stripeCustomerId: stripeCustomer.id,
            });
            resolvedCompanyName = company?.name || "Unknown Company";
          } else {
            resolvedCompanyName = "Unknown Company";
          }
        }

        // Queue email for each platform admin
        for (const admin of platformAdmins) {
          await this.emailQueue.add(
            "billing-notification",
            {
              jobType: "payment-success-admin" as const,
              payload: {
                to: admin.email,
                adminName: admin.name || "Administrator",
                companyName: resolvedCompanyName,
                amount,
                currency: currency || "usd",
                isOneTimePurchase: isOneTimePurchase || false,
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
        }

        this.logger.log(`Queued payment success admin notification for ${platformAdmins.length} platform admin(s)`);
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to queue payment success admin notification: ${errorMsg}`);
      // Don't throw - notification failure shouldn't block webhook processing
    }
  }

  /**
   * Send trial ending reminder to company admins
   * Sent 3 days before trial expires
   */
  async sendTrialEndingReminderEmail(params: StripeWebhookTrialEndingNotificationParams): Promise<void> {
    const { stripeCustomerId, stripeSubscriptionId, trialEndDate } = params;

    try {
      await this.cls.run(async () => {
        const companyAdmins = await this.userRepository.findCompanyAdminsByStripeCustomerId({ stripeCustomerId });

        if (companyAdmins.length === 0) {
          this.logger.warn(`No company admins found for Stripe customer ${stripeCustomerId} - skipping trial reminder`);
          return;
        }

        for (const admin of companyAdmins) {
          await this.emailQueue.add(
            "billing-notification",
            {
              jobType: "trial-ending-reminder" as const,
              payload: {
                to: admin.email,
                customerName: admin.name || "Customer",
                stripeCustomerId,
                stripeSubscriptionId,
                trialEndDate: trialEndDate.toISOString(),
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
        }

        this.logger.log(
          `Queued trial ending reminder for ${companyAdmins.length} company admin(s) (customer: ${stripeCustomerId})`,
        );
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to queue trial ending reminder: ${errorMsg}`);
      // Don't throw - notification failure shouldn't block webhook processing
    }
  }

  /**
   * Send trial ended notification to company admins
   * Sent when trial expires without payment, warning about 30-day data removal
   */
  async sendTrialEndedEmail(params: StripeWebhookTrialEndedNotificationParams): Promise<void> {
    const { stripeCustomerId, stripeSubscriptionId, companyName, trialEndDate } = params;

    try {
      await this.cls.run(async () => {
        const companyAdmins = await this.userRepository.findCompanyAdminsByStripeCustomerId({ stripeCustomerId });

        if (companyAdmins.length === 0) {
          this.logger.warn(
            `No company admins found for Stripe customer ${stripeCustomerId} - skipping trial ended notification`,
          );
          return;
        }

        // Calculate data removal date (30 days from trial end)
        const dataRemovalDate = new Date(trialEndDate);
        dataRemovalDate.setDate(dataRemovalDate.getDate() + 30);

        for (const admin of companyAdmins) {
          await this.emailQueue.add(
            "billing-notification",
            {
              jobType: "trial-ended" as const,
              payload: {
                to: admin.email,
                customerName: admin.name || "Customer",
                companyName,
                stripeCustomerId,
                stripeSubscriptionId,
                trialEndDate: trialEndDate.toISOString(),
                dataRemovalDate: dataRemovalDate.toISOString(),
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
        }

        this.logger.log(
          `Queued trial ended notification for ${companyAdmins.length} company admin(s) (customer: ${stripeCustomerId})`,
        );
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to queue trial ended notification: ${errorMsg}`);
      // Don't throw - notification failure shouldn't block webhook processing
    }
  }

  /**
   * Send deletion warning email to all company admins
   * Context-aware: shows different message for trial_expired vs subscription_cancelled
   */
  async sendDeletionWarningEmail(params: {
    companyId: string;
    daysRemaining: number;
    deletionDate: Date;
    reason: "trial_expired" | "subscription_cancelled";
  }): Promise<void> {
    const { companyId, daysRemaining, deletionDate, reason } = params;

    try {
      await this.cls.run(async () => {
        // Find company
        const company = await this.companyRepository.findByCompanyId({ companyId });
        if (!company) {
          this.logger.warn(`Cannot send deletion warning: company ${companyId} not found`);
          return;
        }

        // Find all admin users for this company
        const admins = await this.userRepository.findAdminsByCompanyId({ companyId });
        if (admins.length === 0) {
          this.logger.warn(`Cannot send deletion warning: no admins found for company ${companyId}`);
          return;
        }

        // Queue email for each admin
        for (const admin of admins) {
          await this.emailQueue.add(
            "billing-notification",
            {
              jobType: "deletion-warning" as const,
              payload: {
                to: admin.email,
                companyName: company.name ?? "Your company",
                daysRemaining,
                deletionDate: deletionDate.toISOString(),
                reason,
                isTrialExpired: reason === "trial_expired",
                isSubscriptionCancelled: reason === "subscription_cancelled",
                locale: "en",
              },
            },
            {
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
            },
          );
        }

        this.logger.log(`Queued deletion warning emails for company ${companyId} (${admins.length} admins)`);
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to queue deletion warning notification: ${errorMsg}`);
      // Don't throw - notification failure shouldn't block processing
    }
  }

  /**
   * Send subscription cancelled email with 30-day data removal warning
   */
  async sendSubscriptionCancelledEmail(params: { companyId: string; dataRemovalDate: Date }): Promise<void> {
    const { companyId, dataRemovalDate } = params;

    try {
      await this.cls.run(async () => {
        // Find company
        const company = await this.companyRepository.findByCompanyId({ companyId });
        if (!company) {
          this.logger.warn(`Cannot send cancellation email: company ${companyId} not found`);
          return;
        }

        // Find company owner
        const ownerEmail = company.ownerEmail;
        if (!ownerEmail) {
          this.logger.warn(`Cannot send cancellation email: no owner email for company ${companyId}`);
          return;
        }

        await this.emailQueue.add(
          "billing-notification",
          {
            jobType: "subscription-cancelled" as const,
            payload: {
              to: ownerEmail,
              companyName: company.name ?? "Your company",
              dataRemovalDate: dataRemovalDate.toISOString(),
              locale: "en",
            },
          },
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          },
        );

        this.logger.log(`Queued subscription cancelled email for company ${companyId}`);
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to queue subscription cancelled notification: ${errorMsg}`);
      // Don't throw - notification failure shouldn't block processing
    }
  }
}
