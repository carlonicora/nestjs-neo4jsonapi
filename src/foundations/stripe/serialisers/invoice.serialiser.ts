import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi";
import { JsonApiDataInterface } from "../../../core/jsonapi";
import { JsonApiServiceInterface } from "../../../core/jsonapi";
import { BillingCustomerModel } from "../entities/billing-customer.model";
import { Invoice } from "../entities/invoice.entity";
import { InvoiceModel } from "../entities/invoice.model";
import { StripeSubscriptionModel } from "../../stripe-subscription/entities/stripe-subscription.model";

@Injectable()
export class InvoiceSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return InvoiceModel.type;
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
      periodStart: (data: Invoice) => data.periodStart?.toISOString(),
      periodEnd: (data: Invoice) => data.periodEnd?.toISOString(),
      dueDate: (data: Invoice) => data.dueDate?.toISOString(),
      paidAt: (data: Invoice) => data.paidAt?.toISOString(),
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
