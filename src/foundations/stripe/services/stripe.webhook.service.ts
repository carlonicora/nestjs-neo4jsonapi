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

@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly stripeService: StripeService,
    private readonly logger: AppLoggingService,
  ) {}

  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    const stripe = this.stripeService.getClient();
    const webhookSecret = this.stripeService.getWebhookSecret();

    if (!webhookSecret) {
      throw new Error("Webhook secret not configured");
    }

    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

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

  getEventObject<T = Stripe.Event.Data.Object>(event: Stripe.Event): T {
    return event.data.object as T;
  }

  isSubscriptionEvent(eventType: string): boolean {
    return eventType.startsWith("customer.subscription.");
  }

  isInvoiceEvent(eventType: string): boolean {
    return eventType.startsWith("invoice.");
  }

  isPaymentEvent(eventType: string): boolean {
    return (
      eventType.startsWith("payment_intent.") ||
      eventType.startsWith("payment_method.") ||
      eventType.startsWith("charge.")
    );
  }

  isCustomerEvent(eventType: string): boolean {
    return eventType.startsWith("customer.") && !this.isSubscriptionEvent(eventType);
  }
}
