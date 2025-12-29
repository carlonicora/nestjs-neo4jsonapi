import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

@Injectable()
export class StripeSubscriptionService {
  constructor(private readonly stripeService: StripeService) {}

  @HandleStripeErrors()
  async createSubscription(params: {
    stripeCustomerId: string;
    priceId: string;
    paymentMethodId?: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: params.stripeCustomerId,
      items: [{ price: params.priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
      metadata: params.metadata,
    };

    if (params.paymentMethodId) {
      subscriptionParams.default_payment_method = params.paymentMethodId;
    }
    if (params.trialPeriodDays) {
      subscriptionParams.trial_period_days = params.trialPeriodDays;
    }

    return stripe.subscriptions.create(subscriptionParams);
  }

  @HandleStripeErrors()
  async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();
    return stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["latest_invoice", "default_payment_method"],
    });
  }

  @HandleStripeErrors()
  async updateSubscription(params: {
    subscriptionId: string;
    priceId?: string;
    prorationBehavior?: Stripe.SubscriptionUpdateParams.ProrationBehavior;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();
    const updateParams: Stripe.SubscriptionUpdateParams = {};

    if (params.priceId) {
      const currentSub = await stripe.subscriptions.retrieve(params.subscriptionId);
      const itemId = currentSub.items.data[0]?.id;
      if (itemId) {
        updateParams.items = [{ id: itemId, price: params.priceId }];
      }
    }

    if (params.prorationBehavior) {
      updateParams.proration_behavior = params.prorationBehavior;
    }

    if (params.metadata) {
      updateParams.metadata = params.metadata;
    }

    return stripe.subscriptions.update(params.subscriptionId, updateParams);
  }

  @HandleStripeErrors()
  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean = true): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();

    if (cancelAtPeriodEnd) {
      return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    }
    return stripe.subscriptions.cancel(subscriptionId);
  }

  @HandleStripeErrors()
  async pauseSubscription(subscriptionId: string, resumeAt?: Date): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();

    const pauseCollection: Stripe.SubscriptionUpdateParams.PauseCollection = {
      behavior: "mark_uncollectible",
    };
    if (resumeAt) {
      pauseCollection.resumes_at = Math.floor(resumeAt.getTime() / 1000);
    }

    return stripe.subscriptions.update(subscriptionId, { pause_collection: pauseCollection });
  }

  @HandleStripeErrors()
  async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();
    return stripe.subscriptions.update(subscriptionId, { pause_collection: "" as any });
  }

  @HandleStripeErrors()
  async previewProration(subscriptionId: string, newPriceId: string): Promise<Stripe.UpcomingInvoice> {
    const stripe = this.stripeService.getClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items.data[0]?.id;

    return stripe.invoices.createPreview({
      customer: subscription.customer as string,
      subscription: subscriptionId,
      subscription_details: {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: "create_prorations",
      },
    });
  }

  @HandleStripeErrors()
  async listSubscriptions(
    stripeCustomerId: string,
    status?: Stripe.SubscriptionListParams.Status,
  ): Promise<Stripe.Subscription[]> {
    const stripe = this.stripeService.getClient();
    const params: Stripe.SubscriptionListParams = {
      customer: stripeCustomerId,
      limit: 100,
    };
    if (status) {
      params.status = status;
    }
    const subscriptions = await stripe.subscriptions.list(params);
    return subscriptions.data;
  }
}
