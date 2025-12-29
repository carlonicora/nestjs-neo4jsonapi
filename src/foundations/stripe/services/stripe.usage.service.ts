import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

/**
 * Stripe Usage Service
 *
 * Manages usage-based billing with Stripe's V2 Billing Meters API (Stripe v20+).
 * Allows reporting meter events for usage-based pricing and retrieving usage summaries.
 * Requires billing meters to be configured in the Stripe Dashboard.
 *
 * @example
 * ```typescript
 * // Report API call usage
 * await stripeUsageService.reportMeterEvent({
 *   eventName: 'api_call',
 *   customerId: 'cus_abc123',
 *   value: 100,
 * });
 *
 * // Get usage summary
 * const summaries = await stripeUsageService.getMeterEventSummaries({
 *   meterId: 'mtr_api_calls',
 *   customerId: 'cus_abc123',
 *   startTime: startTimestamp,
 *   endTime: endTimestamp,
 * });
 * ```
 */
@Injectable()
export class StripeUsageService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Report usage using the V2 Billing Meters API (Stripe v20+)
   *
   * @param params - Meter event parameters
   * @param params.eventName - Name of the meter event
   * @param params.customerId - Stripe customer ID
   * @param params.value - Usage value to report
   * @param params.timestamp - Unix timestamp for the event (optional, defaults to now)
   * @param params.identifier - Unique identifier for deduplication (optional)
   * @returns Promise resolving to the created meter event
   * @throws {StripeError} If event reporting fails
   *
   * @example
   * ```typescript
   * const event = await service.reportMeterEvent({
   *   eventName: 'api_call',
   *   customerId: 'cus_abc123',
   *   value: 100,
   *   identifier: 'request_unique_id',
   * });
   * ```
   *
   * @remarks
   * Requires a billing meter to be set up in Stripe Dashboard. The meter must be
   * associated with a price on the customer's subscription.
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
   *
   * @param params - Summary query parameters
   * @param params.meterId - The billing meter ID
   * @param params.customerId - Stripe customer ID
   * @param params.startTime - Start timestamp (Unix seconds)
   * @param params.endTime - End timestamp (Unix seconds)
   * @returns Promise resolving to array of meter event summaries
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const summaries = await service.getMeterEventSummaries({
   *   meterId: 'mtr_api_calls',
   *   customerId: 'cus_abc123',
   *   startTime: 1704067200, // Jan 1, 2024
   *   endTime: 1706745600,   // Feb 1, 2024
   * });
   * ```
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
   * List all billing meters configured in Stripe
   *
   * @returns Promise resolving to array of billing meters
   * @throws {StripeError} If listing fails
   *
   * @example
   * ```typescript
   * const meters = await service.listMeters();
   * meters.forEach(meter => {
   *   console.log(`${meter.display_name}: ${meter.event_name}`);
   * });
   * ```
   */
  @HandleStripeErrors()
  async listMeters(): Promise<Stripe.Billing.Meter[]> {
    const stripe = this.stripeService.getClient();
    const meters = await stripe.billing.meters.list();
    return meters.data;
  }

  /**
   * Get a subscription item configured for metered billing
   *
   * @param subscriptionId - The subscription ID
   * @returns Promise resolving to the metered subscription item, or null if none found
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const item = await service.getSubscriptionItemForMeteredBilling('sub_abc123');
   * if (item) {
   *   console.log('Metered item ID:', item.id);
   * }
   * ```
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
