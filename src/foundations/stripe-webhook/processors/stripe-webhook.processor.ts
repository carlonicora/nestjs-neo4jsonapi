import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Optional } from "@nestjs/common";
import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import Stripe from "stripe";
import {
  REFERRAL_COMPLETION_HANDLER,
  ReferralCompletionHandler,
} from "../interfaces/referral-completion-handler.interface";
import { QueueId } from "../../../config/enums/queue.id";
import { AppLoggingService } from "../../../core/logging";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeInvoiceRepository } from "../../stripe-invoice/repositories/stripe-invoice.repository";
import { StripeInvoiceAdminService } from "../../stripe-invoice/services/stripe-invoice-admin.service";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { FeatureSyncService } from "../../stripe-subscription/services/feature-sync.service";
import { StripeSubscriptionAdminService } from "../../stripe-subscription/services/stripe-subscription-admin.service";
import { TokenAllocationService } from "../../stripe-subscription/services/token-allocation.service";
import { StripeService } from "../../stripe/services/stripe.service";
import { StripeWebhookEventRepository } from "../repositories/stripe-webhook-event.repository";
import { StripeWebhookNotificationService } from "../services/stripe-webhook-notification.service";

export interface StripeWebhookJobData {
  webhookEventId: string;
  stripeEventId: string;
  eventType: string;
  payload: Record<string, any>;
}

@Processor(QueueId.BILLING_WEBHOOK, { concurrency: 5, lockDuration: 1000 * 60 })
export class StripeWebhookProcessor extends WorkerHost {
  constructor(
    private readonly stripeWebhookEventRepository: StripeWebhookEventRepository,
    private readonly subscriptionService: StripeSubscriptionAdminService,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly subscriptionRepository: StripeSubscriptionRepository,
    private readonly stripeInvoiceRepository: StripeInvoiceRepository,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly notificationService: StripeWebhookNotificationService,
    private readonly tokenAllocationService: TokenAllocationService,
    private readonly featureSyncService: FeatureSyncService,
    private readonly stripeService: StripeService,
    private readonly companyRepository: CompanyRepository,
    private readonly stripeInvoiceAdminService: StripeInvoiceAdminService,
    private readonly logger: AppLoggingService,
    private readonly cls: ClsService,
    private readonly webSocketService: WebSocketService,
    @Optional()
    @Inject(REFERRAL_COMPLETION_HANDLER)
    private readonly referralCompletionHandler?: ReferralCompletionHandler,
  ) {
    super();
  }

  @OnWorkerEvent("active")
  onActive(job: Job<StripeWebhookJobData>) {
    this.logger.debug(`Processing webhook ${job.data.eventType} (ID: ${job.data.stripeEventId})`);
  }

  @OnWorkerEvent("failed")
  onError(job: Job<StripeWebhookJobData>) {
    this.logger.error(
      `Error processing webhook ${job.data.eventType} (ID: ${job.data.stripeEventId}). Reason: ${job.failedReason}`,
    );
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<StripeWebhookJobData>) {
    this.logger.debug(`Completed webhook ${job.data.eventType} (ID: ${job.data.stripeEventId})`);
  }

  async process(job: Job<StripeWebhookJobData>): Promise<void> {
    const { webhookEventId, eventType, payload } = job.data;

    // Wrap in CLS context for repository operations that require it
    await this.cls.run(async () => {
      try {
        await this.stripeWebhookEventRepository.updateStatus({
          id: webhookEventId,
          status: "processing",
        });

        await this.handleEvent(eventType, payload);

        await this.stripeWebhookEventRepository.updateStatus({
          id: webhookEventId,
          status: "completed",
          processedAt: new Date(),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to process webhook ${eventType}: ${errorMessage}`);

        await this.stripeWebhookEventRepository.updateStatus({
          id: webhookEventId,
          status: "failed",
          error: errorMessage,
          incrementRetryCount: true,
        });

        throw error;
      }
    });
  }

  private async handleEvent(eventType: string, payload: Record<string, any>): Promise<void> {
    switch (eventType) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await this.handleSubscriptionEvent(payload as Stripe.Subscription);
        break;

      case "customer.subscription.trial_will_end":
        await this.handleTrialWillEndEvent(payload as Stripe.Subscription);
        break;

      case "invoice.created":
      case "invoice.finalized":
      case "invoice.updated":
      case "invoice.sent":
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
    // Get previous subscription state to detect price changes
    const previousSubscription = await this.subscriptionRepository.findByStripeSubscriptionId({
      stripeSubscriptionId: subscription.id,
    });

    // Get current price ID from Stripe subscription
    const currentStripePriceId = subscription.items?.data?.[0]?.price?.id;
    const priceAmount = subscription.items?.data?.[0]?.price?.unit_amount;

    // Sync subscription from Stripe
    await this.subscriptionService.syncSubscriptionFromStripe({
      stripeSubscriptionId: subscription.id,
    });

    // Update company subscription status based on Stripe subscription status
    try {
      const stripeCustomerId =
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;

      if (stripeCustomerId) {
        const stripeCustomer = await this.stripeCustomerRepository.findByStripeCustomerId({
          stripeCustomerId,
        });

        if (stripeCustomer) {
          const company = await this.companyRepository.findByStripeCustomerId({
            stripeCustomerId: stripeCustomer.id,
          });

          if (company) {
            // NOTE: We do NOT mark isActiveSubscription=true here based on subscription status.
            // The subscription should only be marked active when payment is confirmed (invoice.paid).
            // The TokenAllocationService.allocateTokensOnPayment handles setting isActiveSubscription=true.

            // Handle subscription end states: canceled, past_due, unpaid, incomplete_expired
            const isEndState = ["canceled", "past_due", "unpaid", "incomplete_expired"].includes(subscription.status);

            // Detect trial-to-active transition with $0 price (trial ended without valid paid subscription)
            // When a trial ends with a $0 price, Stripe transitions status from 'trialing' to 'active'
            // but this doesn't represent a valid paid subscription - it's just the trial ending
            const wasTrialing = previousSubscription?.status === "trialing";
            const isNowActive = subscription.status === "active";
            const isTrialEndedWithoutPayment =
              wasTrialing && isNowActive && (priceAmount === 0 || priceAmount === null || priceAmount === undefined);

            // Deactivate subscription if it's an end state OR if trial ended without valid payment
            const shouldDeactivate = isEndState || isTrialEndedWithoutPayment;
            const deactivationReason = isEndState ? subscription.status : "trial_ended_without_payment";

            if (shouldDeactivate) {
              await this.companyRepository.markSubscriptionStatus({
                companyId: company.id,
                isActiveSubscription: false,
              });
              this.logger.log(`Company ${company.id} subscription marked inactive (reason: ${deactivationReason})`);

              // Reset tokens to 0
              await this.companyRepository.updateTokens({
                companyId: company.id,
                monthlyTokens: 0,
                availableMonthlyTokens: 0,
              });
              this.logger.log(`Company ${company.id} tokens reset to 0 (reason: ${deactivationReason})`);

              // Remove features (non-blocking, smart removal)
              try {
                const featureResult = await this.featureSyncService.removeFeaturesOnSubscriptionEnd({
                  stripeSubscriptionId: subscription.id,
                });
                this.logger.log(
                  `Feature removal for subscription ${subscription.id}: ` +
                    `${featureResult.featuresRemoved?.length ?? 0} features removed (reason: ${deactivationReason})`,
                );
              } catch (error) {
                this.logger.error(
                  `Feature removal failed for ${subscription.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
                // Don't throw - feature removal failure should not fail webhook
              }

              // Send trial ended notification (only for trial expirations, not other end states)
              if (isTrialEndedWithoutPayment) {
                const trialEndDate = subscription.trial_end ? new Date(subscription.trial_end * 1000) : new Date();

                // Schedule company deletion
                try {
                  await this.companyRepository.scheduleCompanyDeletion({
                    companyId: company.id,
                    endDate: trialEndDate,
                    reason: "trial_expired",
                  });
                  this.logger.log(`Scheduled deletion for company ${company.id} (trial_expired)`);
                } catch (error) {
                  this.logger.error(
                    `Failed to schedule deletion for ${company.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
                  );
                  // Don't throw - deletion scheduling failure shouldn't block webhook processing
                }

                // Send trial ended notification
                try {
                  await this.notificationService.sendTrialEndedEmail({
                    stripeCustomerId,
                    stripeSubscriptionId: subscription.id,
                    companyName: company.name ?? "Your company",
                    trialEndDate,
                  });
                } catch (error) {
                  this.logger.error(
                    `Failed to send trial ended notification for ${subscription.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
                  );
                  // Don't throw - notification failure shouldn't block webhook processing
                }
              }

              // Send WebSocket to refresh frontend after subscription deactivation
              try {
                await this.webSocketService.sendMessageToCompany(company.id, "company:subscription_updated", {
                  type: "company:subscription_updated",
                  companyId: company.id,
                });
              } catch (error) {
                this.logger.error(
                  `WebSocket notification failed for company ${company.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
                // Don't throw - WebSocket failure should not fail webhook
              }

              // Schedule company deletion for subscription cancellation (not trial expiry)
              if (isEndState && subscription.status === "canceled") {
                try {
                  await this.companyRepository.scheduleCompanyDeletion({
                    companyId: company.id,
                    endDate: new Date(),
                    reason: "subscription_cancelled",
                  });
                  this.logger.log(`Scheduled deletion for company ${company.id} (subscription_cancelled)`);
                } catch (error) {
                  this.logger.error(
                    `Failed to schedule deletion for ${company.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
                  );
                  // Don't throw - deletion scheduling failure shouldn't block webhook processing
                }
              }
            }
          } else {
            this.logger.warn(`Company not found for stripe customer ${stripeCustomerId}`);
          }
        } else {
          this.logger.warn(`Stripe customer ${stripeCustomerId} not found in database`);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to update company subscription status for subscription ${subscription.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // Don't throw - status update failure should not fail webhook processing
    }

    // Detect price change and allocate prorated tokens
    if (previousSubscription && currentStripePriceId) {
      const previousStripePriceId = previousSubscription.stripePrice?.stripePriceId;

      if (previousStripePriceId && previousStripePriceId !== currentStripePriceId) {
        this.logger.log(
          `Price change detected for subscription ${subscription.id}: ${previousStripePriceId} -> ${currentStripePriceId}`,
        );

        // Find the new price in our database by Stripe price ID
        const newPrice = await this.stripePriceRepository.findByStripePriceId({
          stripePriceId: currentStripePriceId,
        });

        if (newPrice) {
          // Allocate prorated tokens (non-blocking - failures don't fail webhook)
          try {
            const result = await this.tokenAllocationService.allocateProratedTokensOnPlanChange({
              stripeSubscriptionId: subscription.id,
              newPriceId: newPrice.id,
            });
            if (result.success) {
              this.logger.debug(
                `Prorated token allocation successful for subscription ${subscription.id}: ${result.tokensAllocated} tokens`,
              );
            } else {
              this.logger.warn(
                `Prorated token allocation skipped for subscription ${subscription.id}: ${result.reason}`,
              );
            }
          } catch (error) {
            this.logger.error(
              `Prorated token allocation failed for subscription ${subscription.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            // Don't throw - token allocation failure should not fail webhook processing
          }
        } else {
          this.logger.warn(
            `New price ${currentStripePriceId} not found in database - skipping prorated token allocation`,
          );
        }
      }
    }
  }

  private async handleTrialWillEndEvent(subscription: Stripe.Subscription): Promise<void> {
    const stripeCustomerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;

    if (!stripeCustomerId) {
      this.logger.warn(`Trial ending subscription ${subscription.id} has no customer ID`);
      return;
    }

    const trialEnd = subscription.trial_end;
    if (!trialEnd) {
      this.logger.warn(`Trial ending subscription ${subscription.id} has no trial_end date`);
      return;
    }

    this.logger.log(`Trial ending in 3 days for subscription ${subscription.id} (customer: ${stripeCustomerId})`);

    // Send reminder notification (non-blocking)
    try {
      await this.notificationService.sendTrialEndingReminderEmail({
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        trialEndDate: new Date(trialEnd * 1000),
      });
    } catch (error) {
      this.logger.error(
        `Failed to send trial ending reminder for ${subscription.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private async handleInvoiceEvent(eventType: string, invoice: Stripe.Invoice): Promise<void> {
    // Sync invoice from Stripe for all invoice events (creates or updates)
    await this.stripeInvoiceAdminService.syncInvoiceFromStripe({
      stripeInvoiceId: invoice.id,
    });

    const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

    if (!stripeCustomerId) {
      this.logger.warn(`Invoice ${invoice.id} has no customer ID`);
      return;
    }

    if (eventType === "invoice.payment_failed") {
      this.logger.warn(`Payment failed for invoice ${invoice.id} (customer: ${stripeCustomerId})`);

      // Find the invoice in our database
      const localInvoice = await this.stripeInvoiceRepository.findByStripeInvoiceId({
        stripeInvoiceId: invoice.id,
      });

      if (localInvoice) {
        // Update invoice status to failed and increment attempt count
        await this.stripeInvoiceRepository.updateByStripeInvoiceId({
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
    // Fallback to invoice.subscription for backwards compatibility and test data
    const subscriptionDetails = invoice.parent?.subscription_details;
    const directSubscription = (invoice as unknown as { subscription?: string | { id: string } }).subscription;

    // Try to get subscription ID from either location
    let subscriptionId: string | undefined;
    if (subscriptionDetails?.subscription) {
      subscriptionId =
        typeof subscriptionDetails.subscription === "string"
          ? subscriptionDetails.subscription
          : subscriptionDetails.subscription.id;
    } else if (directSubscription) {
      subscriptionId = typeof directSubscription === "string" ? directSubscription : directSubscription.id;
    }

    if (eventType === "invoice.paid" && subscriptionId) {
      // Sync subscription first
      await this.subscriptionService.syncSubscriptionFromStripe({
        stripeSubscriptionId: subscriptionId,
      });

      // Allocate tokens (non-blocking - failures don't fail webhook)
      try {
        const result = await this.tokenAllocationService.allocateTokensOnPayment({
          stripeSubscriptionId: subscriptionId,
        });
        if (result.success) {
          this.logger.debug(
            `Token allocation successful for subscription ${subscriptionId}: ${result.tokensAllocated} tokens`,
          );
        } else {
          this.logger.warn(`Token allocation skipped for subscription ${subscriptionId}: ${result.reason}`);
        }
      } catch (error) {
        this.logger.error(
          `Token allocation failed for subscription ${subscriptionId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        // Don't throw - token allocation failure should not fail webhook processing
      }

      // Sync features (non-blocking)
      let featureSyncCompanyId: string | undefined;
      try {
        const featureResult = await this.featureSyncService.syncFeaturesOnPayment({
          stripeSubscriptionId: subscriptionId,
        });
        featureSyncCompanyId = featureResult.companyId;
        if (featureResult.success && featureResult.featuresAdded?.length) {
          this.logger.debug(
            `Feature sync: ${featureResult.featuresAdded.length} features added for subscription ${subscriptionId}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Feature sync failed for ${subscriptionId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        // Don't throw - feature sync failure should not fail webhook
      }

      // Send WebSocket to refresh frontend after feature sync
      if (featureSyncCompanyId) {
        try {
          await this.webSocketService.sendMessageToCompany(featureSyncCompanyId, "company:subscription_updated", {
            type: "company:subscription_updated",
            companyId: featureSyncCompanyId,
          });
        } catch (error) {
          this.logger.error(
            `WebSocket notification failed for company ${featureSyncCompanyId}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          // Don't throw - WebSocket failure should not fail webhook
        }

        // Clear any pending deletion schedule (user resubscribed)
        try {
          const company = await this.companyRepository.findByCompanyId({ companyId: featureSyncCompanyId });
          if (company?.scheduledDeletionAt) {
            await this.companyRepository.clearDeletionSchedule({ companyId: featureSyncCompanyId });
            this.logger.log(`Cleared deletion schedule for company ${featureSyncCompanyId} (payment received)`);
          }
        } catch (error) {
          this.logger.error(
            `Failed to clear deletion schedule for ${featureSyncCompanyId}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          // Don't throw - deletion schedule clear failure should not fail webhook
        }

        // Complete referral if handler is provided (non-blocking)
        // Only for paid invoices - skip $0 trial/free invoices
        if (this.referralCompletionHandler && invoice.amount_paid > 0) {
          try {
            await this.referralCompletionHandler.completeReferralOnPayment({
              referredCompanyId: featureSyncCompanyId,
            });
          } catch (error) {
            this.logger.error(
              `Referral completion failed for company ${featureSyncCompanyId}: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            // Don't throw - referral failure should not fail webhook processing
          }
        }
      }

      // Send payment success notifications (non-blocking)
      // Skip for $0 invoices (trials, free tiers)
      if (invoice.amount_paid > 0) {
        try {
          await this.notificationService.sendPaymentSuccessToCompanyAdmins({
            stripeCustomerId,
            stripeInvoiceId: invoice.id,
            amount: invoice.amount_paid / 100, // Convert cents to dollars
            currency: invoice.currency,
            isOneTimePurchase: false,
          });
          await this.notificationService.sendPaymentSuccessToPlatformAdmins({
            stripeCustomerId,
            stripeInvoiceId: invoice.id,
            amount: invoice.amount_paid / 100,
            currency: invoice.currency,
            isOneTimePurchase: false,
          });
        } catch (error) {
          this.logger.error(
            `Failed to send payment success notifications for invoice ${invoice.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          // Don't throw - notification failure should not fail webhook processing
        }
      }
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
      await this.stripeCustomerRepository.updateByStripeCustomerId({
        stripeCustomerId: customer.id,
        email: customer.email || undefined,
        name: customer.name || undefined,
      });
    }
  }

  private async handlePaymentIntentEvent(eventType: string, paymentIntent: Stripe.PaymentIntent): Promise<void> {
    if (eventType === "payment_intent.succeeded") {
      // Check if this is a one-time purchase by checking metadata
      const metadata = paymentIntent.metadata || {};

      if (metadata.type === "one_time_purchase") {
        // Update the local subscription record from "incomplete" to "active"
        const existingSubscription = await this.subscriptionRepository.findByStripeSubscriptionId({
          stripeSubscriptionId: paymentIntent.id,
        });

        if (existingSubscription && existingSubscription.status === "incomplete") {
          await this.subscriptionRepository.updateByStripeSubscriptionId({
            stripeSubscriptionId: paymentIntent.id,
            status: "active",
          });
          this.logger.debug(`One-time purchase ${paymentIntent.id} marked as active`);
        }

        // Allocate extra tokens (non-blocking - failures don't fail webhook)
        try {
          const result = await this.tokenAllocationService.allocateExtraTokensOnOneTimePurchase({
            paymentIntentId: paymentIntent.id,
          });
          if (result.success) {
            this.logger.debug(
              `Extra token allocation successful for one-time purchase ${paymentIntent.id}: ${result.tokensAllocated} tokens added`,
            );
          } else {
            this.logger.warn(
              `Extra token allocation skipped for one-time purchase ${paymentIntent.id}: ${result.reason}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Extra token allocation failed for one-time purchase ${paymentIntent.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          // Don't throw - token allocation failure should not fail webhook processing
        }

        // Send payment success notifications (non-blocking)
        const stripeCustomerId =
          typeof paymentIntent.customer === "string" ? paymentIntent.customer : paymentIntent.customer?.id;

        if (stripeCustomerId) {
          try {
            await this.notificationService.sendPaymentSuccessToCompanyAdmins({
              stripeCustomerId,
              stripePaymentIntentId: paymentIntent.id,
              amount: paymentIntent.amount / 100, // Convert cents to dollars
              currency: paymentIntent.currency,
              isOneTimePurchase: true,
            });
            await this.notificationService.sendPaymentSuccessToPlatformAdmins({
              stripeCustomerId,
              stripePaymentIntentId: paymentIntent.id,
              amount: paymentIntent.amount / 100,
              currency: paymentIntent.currency,
              isOneTimePurchase: true,
            });
          } catch (error) {
            this.logger.error(
              `Failed to send payment success notifications for payment intent ${paymentIntent.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            // Don't throw - notification failure should not fail webhook processing
          }
        }

        return;
      }

      // Regular subscription payment flow
      // When payment succeeds, sync any related subscription to update its status
      // PaymentIntent metadata or invoice relationship can tell us which subscription
      const paymentIntentData = paymentIntent as unknown as Record<string, unknown>;
      const invoiceId =
        typeof paymentIntentData.invoice === "string"
          ? paymentIntentData.invoice
          : (paymentIntentData.invoice as { id?: string })?.id;

      if (invoiceId) {
        // Fetch the invoice from Stripe to get the subscription ID
        try {
          const stripe = this.stripeService.getClient();
          const stripeInvoice = await stripe.invoices.retrieve(invoiceId);
          // In Stripe v20, subscription is nested under parent.subscription_details
          const subscriptionDetails = stripeInvoice.parent?.subscription_details;
          if (subscriptionDetails?.subscription) {
            const subscriptionId =
              typeof subscriptionDetails.subscription === "string"
                ? subscriptionDetails.subscription
                : subscriptionDetails.subscription.id;

            this.logger.debug(`Payment succeeded for subscription ${subscriptionId} - syncing from Stripe`);
            await this.subscriptionService.syncSubscriptionFromStripe({
              stripeSubscriptionId: subscriptionId,
            });
          }
        } catch (error) {
          this.logger.warn(
            `Failed to fetch invoice ${invoiceId} from Stripe: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
      return;
    }

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
