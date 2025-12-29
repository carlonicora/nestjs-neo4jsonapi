import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";

export interface WebhookEventData {
  id: string;
  type: string;
  livemode: boolean;
  created: Date;
  data: Stripe.Event.Data;
  apiVersion: string | null;
}

/**
 * Stripe Webhook Service
 *
 * Handles Stripe webhook event verification and parsing. Provides utilities to validate
 * webhook signatures, extract event data, and categorize events by type.
 *
 * @example
 * ```typescript
 * // In webhook handler
 * const event = webhookService.constructEvent(payload, signature);
 * const eventData = webhookService.parseEvent(event);
 *
 * if (webhookService.isSubscriptionEvent(event.type)) {
 *   const subscription = webhookService.getEventObject<Stripe.Subscription>(event);
 *   // Handle subscription event
 * }
 * ```
 */
@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly stripeService: StripeService,
    private readonly logger: AppLoggingService,
  ) {}

  /**
   * Construct and verify a Stripe webhook event
   *
   * @param payload - Raw request body buffer
   * @param signature - Stripe signature header value
   * @returns Verified Stripe event object
   * @throws {Error} If webhook secret is not configured
   * @throws {Error} If signature verification fails
   *
   * @example
   * ```typescript
   * // In Express/NestJS controller
   * const payload = request.rawBody; // Must be raw buffer, not parsed JSON
   * const signature = request.headers['stripe-signature'];
   * const event = service.constructEvent(payload, signature);
   * ```
   *
   * @remarks
   * The payload must be the raw request body as a Buffer, not parsed JSON.
   * Signature verification ensures the event came from Stripe.
   */
  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    const stripe = this.stripeService.getClient();
    const webhookSecret = this.stripeService.getWebhookSecret();

    if (!webhookSecret) {
      throw new Error("Webhook secret not configured");
    }

    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  /**
   * Parse a Stripe event into a structured format
   *
   * @param event - The Stripe event object
   * @returns Parsed webhook event data
   *
   * @example
   * ```typescript
   * const event = service.constructEvent(payload, signature);
   * const parsedData = service.parseEvent(event);
   * console.log(`Event ${parsedData.id} of type ${parsedData.type}`);
   * ```
   */
  parseEvent(event: Stripe.Event): WebhookEventData {
    return {
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      created: new Date(event.created * 1000),
      data: event.data,
      apiVersion: event.api_version,
    };
  }

  /**
   * Extract the event object with proper typing
   *
   * @param event - The Stripe event
   * @returns The typed event data object
   *
   * @example
   * ```typescript
   * const subscription = service.getEventObject<Stripe.Subscription>(event);
   * console.log(subscription.status);
   * ```
   */
  getEventObject<T = Stripe.Event.Data.Object>(event: Stripe.Event): T {
    return event.data.object as T;
  }

  /**
   * Check if event is subscription-related
   *
   * @param eventType - The event type string
   * @returns True if event is subscription-related
   *
   * @example
   * ```typescript
   * if (service.isSubscriptionEvent(event.type)) {
   *   // Handle subscription.created, subscription.updated, etc.
   * }
   * ```
   */
  isSubscriptionEvent(eventType: string): boolean {
    return eventType.startsWith("customer.subscription.");
  }

  /**
   * Check if event is invoice-related
   *
   * @param eventType - The event type string
   * @returns True if event is invoice-related
   *
   * @example
   * ```typescript
   * if (service.isInvoiceEvent(event.type)) {
   *   // Handle invoice.created, invoice.payment_failed, etc.
   * }
   * ```
   */
  isInvoiceEvent(eventType: string): boolean {
    return eventType.startsWith("invoice.");
  }

  /**
   * Check if event is payment-related
   *
   * @param eventType - The event type string
   * @returns True if event is payment-related
   *
   * @example
   * ```typescript
   * if (service.isPaymentEvent(event.type)) {
   *   // Handle payment_intent.*, payment_method.*, charge.*
   * }
   * ```
   */
  isPaymentEvent(eventType: string): boolean {
    return (
      eventType.startsWith("payment_intent.") ||
      eventType.startsWith("payment_method.") ||
      eventType.startsWith("charge.")
    );
  }

  /**
   * Check if event is customer-related (excluding subscriptions)
   *
   * @param eventType - The event type string
   * @returns True if event is customer-related but not subscription-related
   *
   * @example
   * ```typescript
   * if (service.isCustomerEvent(event.type)) {
   *   // Handle customer.created, customer.updated, customer.deleted
   * }
   * ```
   */
  isCustomerEvent(eventType: string): boolean {
    return eventType.startsWith("customer.") && !this.isSubscriptionEvent(eventType);
  }
}
