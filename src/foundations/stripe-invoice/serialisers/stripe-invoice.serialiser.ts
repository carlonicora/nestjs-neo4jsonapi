import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "../../../config/interfaces/base.config.interface";
import {
  AbstractJsonApiSerialiser,
  JsonApiDataInterface,
  JsonApiSerialiserFactory,
  JsonApiServiceInterface,
} from "../../../core/jsonapi";
import { StripeCustomerModel } from "../../stripe-customer";
import { StripeSubscriptionDescriptor } from "../../stripe-subscription/entities/stripe-subscription";
import { StripeInvoice } from "../entities/stripe-invoice.entity";
import { StripeInvoiceModel } from "../entities/stripe-invoice.model";

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
      stripeCustomer: {
        data: this.serialiserFactory.create(StripeCustomerModel),
      },
      subscription: {
        data: this.serialiserFactory.create(StripeSubscriptionDescriptor.model),
      },
    };

    return super.create();
  }
}
