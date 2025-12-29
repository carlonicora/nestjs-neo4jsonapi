import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import {
  JsonApiDataInterface,
  JsonApiService,
  StripeCustomerService,
  StripePaymentService,
  StripePortalService,
} from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomer } from "../entities/billing-customer.entity";
import { BillingCustomerModel } from "../entities/billing-customer.model";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";

@Injectable()
export class BillingService {
  constructor(
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly stripeCustomerService: StripeCustomerService,
    private readonly stripePaymentService: StripePaymentService,
    private readonly stripePortalService: StripePortalService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  async getCustomerByCompanyId(params: { companyId: string }): Promise<BillingCustomer | null> {
    return this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
  }

  async getCustomerOrFail(params: { companyId: string }): Promise<BillingCustomer> {
    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND);
    }
    return customer;
  }

  async createCustomer(params: {
    companyId: string;
    name: string;
    email: string;
    currency: string;
  }): Promise<JsonApiDataInterface> {
    const existingCustomer = await this.billingCustomerRepository.findByCompanyId({
      companyId: params.companyId,
    });

    if (existingCustomer) {
      throw new HttpException("Billing customer already exists for this company", HttpStatus.CONFLICT);
    }

    const stripeCustomer = await this.stripeCustomerService.createCustomer({
      companyId: params.companyId,
      email: params.email,
      name: params.name,
    });

    const billingCustomer = await this.billingCustomerRepository.create({
      companyId: params.companyId,
      stripeCustomerId: stripeCustomer.id,
      email: params.email,
      name: params.name,
      currency: params.currency,
    });

    return this.jsonApiService.buildSingle(BillingCustomerModel, billingCustomer);
  }

  async getCustomer(params: { companyId: string }): Promise<JsonApiDataInterface> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    return this.jsonApiService.buildSingle(BillingCustomerModel, customer);
  }

  async createSetupIntent(params: {
    companyId: string;
    paymentMethodType?: string;
  }): Promise<{ clientSecret: string }> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    const setupIntent = await this.stripePaymentService.createSetupIntent({
      stripeCustomerId: customer.stripeCustomerId,
    });

    return {
      clientSecret: setupIntent.client_secret,
    };
  }

  async createPortalSession(params: { companyId: string; returnUrl?: string }): Promise<{ url: string }> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    const session = await this.stripePortalService.createPortalSession(customer.stripeCustomerId, params.returnUrl);

    return {
      url: session.url,
    };
  }

  async listPaymentMethods(params: { companyId: string }): Promise<{ data: Stripe.PaymentMethod[] }> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    const paymentMethods = await this.stripeCustomerService.listPaymentMethods(customer.stripeCustomerId, "card");

    return { data: paymentMethods };
  }

  async setDefaultPaymentMethod(params: { companyId: string; paymentMethodId: string }): Promise<void> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    await this.stripeCustomerService.updateCustomer({
      stripeCustomerId: customer.stripeCustomerId,
      defaultPaymentMethodId: params.paymentMethodId,
    });

    await this.billingCustomerRepository.update({
      id: customer.id,
      defaultPaymentMethodId: params.paymentMethodId,
    });
  }

  async removePaymentMethod(params: { companyId: string; paymentMethodId: string }): Promise<void> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    const paymentMethod = await this.stripePaymentService.retrievePaymentMethod(params.paymentMethodId);

    if (paymentMethod.customer !== customer.stripeCustomerId) {
      throw new HttpException("Payment method does not belong to this customer", HttpStatus.FORBIDDEN);
    }

    await this.stripeCustomerService.detachPaymentMethod(params.paymentMethodId);

    if (customer.defaultPaymentMethodId === params.paymentMethodId) {
      await this.billingCustomerRepository.update({
        id: customer.id,
        defaultPaymentMethodId: null,
      });
    }
  }

  async syncCustomerFromStripe(params: { stripeCustomerId: string }): Promise<void> {
    try {
      const stripeCustomer = await this.stripeCustomerService.retrieveCustomer(params.stripeCustomerId);

      const existingCustomer = await this.billingCustomerRepository.findByStripeCustomerId({
        stripeCustomerId: params.stripeCustomerId,
      });

      if (existingCustomer) {
        await this.billingCustomerRepository.updateByStripeCustomerId({
          stripeCustomerId: params.stripeCustomerId,
          email: stripeCustomer.email ?? existingCustomer.email,
          name: stripeCustomer.name ?? existingCustomer.name,
          defaultPaymentMethodId:
            typeof stripeCustomer.invoice_settings?.default_payment_method === "string"
              ? stripeCustomer.invoice_settings.default_payment_method
              : (stripeCustomer.invoice_settings?.default_payment_method as Stripe.PaymentMethod)?.id,
          balance: stripeCustomer.balance,
          delinquent: stripeCustomer.delinquent ?? false,
        });
      }
    } catch (error) {
      // Customer may have been deleted, silently ignore
      if (error instanceof Error && error.message === "Customer has been deleted") {
        return;
      }
      throw error;
    }
  }
}
