import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "../../../config/interfaces/base.config.interface";
import {
  AbstractJsonApiSerialiser,
  JsonApiDataInterface,
  JsonApiSerialiserFactory,
  JsonApiServiceInterface,
} from "../../../core/jsonapi";
import { StripeProductModel } from "../../stripe-product/entities/stripe-product.model";
import { StripePrice } from "../entities/stripe-price.entity";
import { StripePriceModel } from "../entities/stripe-price.model";

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
      productId: (data: StripePrice) => data.stripeProduct?.id,
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
      description: "description",
      features: "features",
      token: (data: StripePrice) => (data.token !== undefined ? Number(data.token) : undefined),
    };

    this.relationships = {
      stripeProduct: {
        name: "product",
        data: this.serialiserFactory.create(StripeProductModel),
      },
    };

    return super.create();
  }
}
