import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { AbstractJsonApiSerialiser } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiSerialiserFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiServiceInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { StripePriceModel } from "../entities/stripe-price.model";
import { Subscription } from "../entities/subscription.entity";
import { SubscriptionModel } from "../entities/subscription.model";

@Injectable()
export class SubscriptionSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return SubscriptionModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      stripeSubscriptionId: "stripeSubscriptionId",
      stripeSubscriptionItemId: "stripeSubscriptionItemId",
      status: "status",
      currentPeriodStart: (data: Subscription) => data.currentPeriodStart?.toISOString(),
      currentPeriodEnd: (data: Subscription) => data.currentPeriodEnd?.toISOString(),
      cancelAtPeriodEnd: "cancelAtPeriodEnd",
      canceledAt: (data: Subscription) => data.canceledAt?.toISOString(),
      trialStart: (data: Subscription) => data.trialStart?.toISOString(),
      trialEnd: (data: Subscription) => data.trialEnd?.toISOString(),
      pausedAt: (data: Subscription) => data.pausedAt?.toISOString(),
      quantity: (data: Subscription) => Number(data.quantity ?? 1),
    };

    this.relationships = {
      price: {
        data: this.serialiserFactory.create(StripePriceModel),
      },
    };

    return super.create();
  }
}
