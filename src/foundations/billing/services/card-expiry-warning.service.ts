import { Injectable, Logger } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { StripeCustomerApiService } from "../../stripe-customer/services/stripe-customer-api.service";
import {
  StripeSubscription,
  StripeSubscriptionDescriptor,
} from "../../stripe-subscription/entities/stripe-subscription";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeWebhookNotificationService } from "../../stripe-webhook/services/stripe-webhook-notification.service";

const WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Warns a GM about a week before renewal when the card on file expires before the renewal date.
 *
 * Worker cron only: the repository finder reads across every company. Each subscription is
 * checked once per renewal (`cardExpiryCheckedFor` stores the `currentPeriodEnd` it ran for).
 * A Stripe error leaves the subscription unmarked, so the next hourly run tries again.
 */
@Injectable()
export class CardExpiryWarningService extends AbstractService<
  StripeSubscription,
  typeof StripeSubscriptionDescriptor.relationships
> {
  protected readonly descriptor = StripeSubscriptionDescriptor;
  private readonly logger: Logger = new Logger(CardExpiryWarningService.name);

  constructor(
    jsonApiService: JsonApiService,
    private readonly stripeSubscriptionRepository: StripeSubscriptionRepository,
    clsService: ClsService,
    private readonly stripeCustomerApiService: StripeCustomerApiService,
    private readonly notificationService: StripeWebhookNotificationService,
  ) {
    super(jsonApiService, stripeSubscriptionRepository, clsService, StripeSubscriptionDescriptor.model);
  }

  async processDue(params: { now: Date }): Promise<{ checked: number; warned: number }> {
    const subscriptions = await this.stripeSubscriptionRepository.findRenewalsForCardCheck({
      now: params.now,
      before: new Date(params.now.getTime() + WARNING_WINDOW_MS),
    });

    let checked = 0;
    let warned = 0;

    for (const subscription of subscriptions) {
      try {
        const renewalDate = new Date(subscription.currentPeriodEnd);
        const stripeCustomerId = subscription.stripeCustomer.stripeCustomerId;

        const card = await this.stripeCustomerApiService.getDefaultCard({
          stripeCustomerId,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        });

        if (card && renewalDate.getTime() >= this.firstMomentAfterExpiry(card).getTime()) {
          await this.notificationService.sendCardExpiringEmail({
            stripeCustomerId,
            renewalDate: subscription.currentPeriodEnd,
            cardBrand: card.brand,
            cardLast4: card.last4,
          });
          warned++;
        }

        await this.stripeSubscriptionRepository.update({
          id: subscription.id,
          cardExpiryCheckedFor: subscription.currentPeriodEnd,
        });
        checked++;
      } catch (error) {
        this.logger.error(
          `Card expiry check failed for subscription ${subscription.id}; retrying next run: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { checked, warned };
  }

  /** A card is valid through the last day of its expiry month (UTC): this is the first instant after it. */
  private firstMomentAfterExpiry(card: { expMonth: number; expYear: number }): Date {
    // Date.UTC months are 0-based, so `expMonth` (1-based) is already the following month.
    return new Date(Date.UTC(card.expYear, card.expMonth, 1));
  }
}
