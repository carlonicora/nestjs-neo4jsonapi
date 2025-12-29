import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { AbstractJsonApiSerialiser } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiSerialiserFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiServiceInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { StripePrice } from "../entities/stripe-price.entity";
import { StripePriceModel } from "../entities/stripe-price.model";
import { StripeProductModel } from "../entities/stripe-product.model";

@Injectable()
export class StripePriceSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return StripePriceModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      stripePriceId: "stripePriceId",
      active: "active",
      currency: "currency",
      unitAmount: (data: StripePrice) => (data.unitAmount ? Number(data.unitAmount) : undefined),
      priceType: "priceType",
      recurringInterval: "recurringInterval",
      recurringIntervalCount: (data: StripePrice) =>
        data.recurringIntervalCount ? Number(data.recurringIntervalCount) : undefined,
      recurringUsageType: "recurringUsageType",
      nickname: "nickname",
      lookupKey: "lookupKey",
      metadata: (data: StripePrice) => {
        if (!data.metadata) return undefined;
        try {
          return JSON.parse(data.metadata);
        } catch {
          return data.metadata;
        }
      },
    };

    this.relationships = {
      product: {
        data: this.serialiserFactory.create(StripeProductModel),
      },
    };

    return super.create();
  }
}
