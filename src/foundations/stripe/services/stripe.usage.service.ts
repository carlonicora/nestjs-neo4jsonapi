import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

@Injectable()
export class StripeUsageService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Report usage using the V2 Billing Meters API (Stripe v20+)
   * Note: Requires a billing meter to be set up in Stripe Dashboard
   */
  @HandleStripeErrors()
  async reportMeterEvent(params: {
    eventName: string;
    customerId: string;
    value: number;
    timestamp?: number;
    identifier?: string;
  }): Promise<Stripe.V2.Billing.MeterEvent> {
    const stripe = this.stripeService.getClient();

    return stripe.v2.billing.meterEvents.create({
      event_name: params.eventName,
      payload: {
        stripe_customer_id: params.customerId,
        value: String(params.value),
      },
      identifier: params.identifier,
      timestamp: params.timestamp ? new Date(params.timestamp * 1000).toISOString() : undefined,
    });
  }

  /**
   * List meter event summaries for a customer
   */
  @HandleStripeErrors()
  async getMeterEventSummaries(params: {
    meterId: string;
    customerId: string;
    startTime: number;
    endTime: number;
  }): Promise<Stripe.Billing.MeterEventSummary[]> {
    const stripe = this.stripeService.getClient();

    const summaries = await stripe.billing.meters.listEventSummaries(params.meterId, {
      customer: params.customerId,
      start_time: params.startTime,
      end_time: params.endTime,
    });

    return summaries.data;
  }

  /**
   * List all billing meters
   */
  @HandleStripeErrors()
  async listMeters(): Promise<Stripe.Billing.Meter[]> {
    const stripe = this.stripeService.getClient();
    const meters = await stripe.billing.meters.list();
    return meters.data;
  }

  /**
   * Get a subscription item for metered billing
   */
  @HandleStripeErrors()
  async getSubscriptionItemForMeteredBilling(subscriptionId: string): Promise<Stripe.SubscriptionItem | null> {
    const stripe = this.stripeService.getClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });

    const meteredItem = subscription.items.data.find((item) => {
      const price = item.price as Stripe.Price;
      return price.recurring?.meter;
    });

    return meteredItem || null;
  }
}
