import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { AbstractJsonApiSerialiser } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiSerialiserFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiServiceInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProduct } from "../entities/stripe-product.entity";
import { StripeProductModel } from "../entities/stripe-product.model";

@Injectable()
export class StripeProductSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return StripeProductModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      stripeProductId: "stripeProductId",
      name: "name",
      description: "description",
      active: "active",
      metadata: (data: StripeProduct) => {
        if (!data.metadata) return undefined;
        try {
          return JSON.parse(data.metadata);
        } catch {
          return data.metadata;
        }
      },
    };

    return super.create();
  }
}
