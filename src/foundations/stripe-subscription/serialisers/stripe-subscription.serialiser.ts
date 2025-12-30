import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi";
import { JsonApiDataInterface } from "../../../core/jsonapi";
import { JsonApiServiceInterface } from "../../../core/jsonapi";
import { StripePriceModel } from "../../stripe-price/entities/stripe-price.model";
import { StripeSubscription } from "../entities/stripe-subscription.entity";
import { StripeSubscriptionModel } from "../entities/stripe-subscription.model";

@Injectable()
export class StripeSubscriptionSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return StripeSubscriptionModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      stripeSubscriptionId: "stripeSubscriptionId",
      stripeSubscriptionItemId: "stripeSubscriptionItemId",
      status: "status",
      currentPeriodStart: (data: StripeSubscription) => data.currentPeriodStart?.toISOString(),
      currentPeriodEnd: (data: StripeSubscription) => data.currentPeriodEnd?.toISOString(),
      cancelAtPeriodEnd: "cancelAtPeriodEnd",
      canceledAt: (data: StripeSubscription) => data.canceledAt?.toISOString(),
      trialStart: (data: StripeSubscription) => data.trialStart?.toISOString(),
      trialEnd: (data: StripeSubscription) => data.trialEnd?.toISOString(),
      pausedAt: (data: StripeSubscription) => data.pausedAt?.toISOString(),
      quantity: (data: StripeSubscription) => Number(data.quantity ?? 1),
    };

    this.relationships = {
      price: {
        data: this.serialiserFactory.create(StripePriceModel),
      },
    };

    return super.create();
  }
}
