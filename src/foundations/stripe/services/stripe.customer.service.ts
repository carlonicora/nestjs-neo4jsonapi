import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

@Injectable()
export class StripeCustomerService {
  constructor(private readonly stripeService: StripeService) {}

  @HandleStripeErrors()
  async createCustomer(params: {
    companyId: string;
    email: string;
    name: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    const stripe = this.stripeService.getClient();
    return stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: { companyId: params.companyId, ...params.metadata },
    });
  }

  @HandleStripeErrors()
  async retrieveCustomer(stripeCustomerId: string): Promise<Stripe.Customer> {
    const stripe = this.stripeService.getClient();
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (customer.deleted) {
      throw new Error("Customer has been deleted");
    }
    return customer as Stripe.Customer;
  }

  @HandleStripeErrors()
  async updateCustomer(params: {
    stripeCustomerId: string;
    email?: string;
    name?: string;
    defaultPaymentMethodId?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    const stripe = this.stripeService.getClient();
    const updateData: Stripe.CustomerUpdateParams = {};
    if (params.email) updateData.email = params.email;
    if (params.name) updateData.name = params.name;
    if (params.defaultPaymentMethodId) {
      updateData.invoice_settings = { default_payment_method: params.defaultPaymentMethodId };
    }
    if (params.metadata) updateData.metadata = params.metadata;
    return stripe.customers.update(params.stripeCustomerId, updateData);
  }

  @HandleStripeErrors()
  async deleteCustomer(stripeCustomerId: string): Promise<Stripe.DeletedCustomer> {
    const stripe = this.stripeService.getClient();
    return stripe.customers.del(stripeCustomerId);
  }

  @HandleStripeErrors()
  async listPaymentMethods(
    stripeCustomerId: string,
    type: Stripe.PaymentMethodListParams.Type = "card",
  ): Promise<Stripe.PaymentMethod[]> {
    const stripe = this.stripeService.getClient();
    const paymentMethods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type,
    });
    return paymentMethods.data;
  }

  @HandleStripeErrors()
  async setDefaultPaymentMethod(stripeCustomerId: string, paymentMethodId: string): Promise<Stripe.Customer> {
    const stripe = this.stripeService.getClient();
    return stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  @HandleStripeErrors()
  async detachPaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentMethods.detach(paymentMethodId);
  }
}
