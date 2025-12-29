import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

@Injectable()
export class StripePaymentService {
  constructor(private readonly stripeService: StripeService) {}

  @HandleStripeErrors()
  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    stripeCustomerId: string;
    metadata?: Record<string, string>;
    description?: string;
    receiptEmail?: string;
  }): Promise<Stripe.PaymentIntent> {
    const stripe = this.stripeService.getClient();

    return stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency,
      customer: params.stripeCustomerId,
      automatic_payment_methods: { enabled: true },
      metadata: params.metadata,
      description: params.description,
      receipt_email: params.receiptEmail,
    });
  }

  @HandleStripeErrors()
  async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentIntents.retrieve(paymentIntentId);
  }

  @HandleStripeErrors()
  async createSetupIntent(params: {
    stripeCustomerId: string;
    metadata?: Record<string, string>;
    usage?: "on_session" | "off_session";
  }): Promise<Stripe.SetupIntent> {
    const stripe = this.stripeService.getClient();

    return stripe.setupIntents.create({
      customer: params.stripeCustomerId,
      automatic_payment_methods: { enabled: true },
      metadata: params.metadata,
      usage: params.usage || "off_session",
    });
  }

  @HandleStripeErrors()
  async retrieveSetupIntent(setupIntentId: string): Promise<Stripe.SetupIntent> {
    const stripe = this.stripeService.getClient();
    return stripe.setupIntents.retrieve(setupIntentId);
  }

  @HandleStripeErrors()
  async confirmPaymentIntent(paymentIntentId: string, paymentMethodId: string): Promise<Stripe.PaymentIntent> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethodId,
    });
  }

  @HandleStripeErrors()
  async cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentIntents.cancel(paymentIntentId);
  }

  @HandleStripeErrors()
  async retrievePaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentMethods.retrieve(paymentMethodId);
  }
}
