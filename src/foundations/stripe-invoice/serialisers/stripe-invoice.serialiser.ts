import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi";
import { JsonApiDataInterface } from "../../../core/jsonapi";
import { JsonApiServiceInterface } from "../../../core/jsonapi";
import { BillingCustomerModel } from "../../stripe/entities/billing-customer.model";
import { StripeInvoice } from "../entities/stripe-invoice.entity";
import { StripeInvoiceModel } from "../entities/stripe-invoice.model";
import { StripeSubscriptionModel } from "../../stripe-subscription/entities/stripe-subscription.model";

@Injectable()
export class StripeInvoiceSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return StripeInvoiceModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      stripeInvoiceId: "stripeInvoiceId",
      stripeInvoiceNumber: "stripeInvoiceNumber",
      stripeHostedInvoiceUrl: "stripeHostedInvoiceUrl",
      stripePdfUrl: "stripePdfUrl",
      status: "status",
      currency: "currency",
      amountDue: "amountDue",
      amountPaid: "amountPaid",
      amountRemaining: "amountRemaining",
      subtotal: "subtotal",
      total: "total",
      tax: "tax",
      periodStart: (data: StripeInvoice) => data.periodStart?.toISOString(),
      periodEnd: (data: StripeInvoice) => data.periodEnd?.toISOString(),
      dueDate: (data: StripeInvoice) => data.dueDate?.toISOString(),
      paidAt: (data: StripeInvoice) => data.paidAt?.toISOString(),
      attemptCount: "attemptCount",
      attempted: "attempted",
    };

    this.relationships = {
      billingCustomer: {
        data: this.serialiserFactory.create(BillingCustomerModel),
      },
      subscription: {
        data: this.serialiserFactory.create(StripeSubscriptionModel),
      },
    };

    return super.create();
  }
}
