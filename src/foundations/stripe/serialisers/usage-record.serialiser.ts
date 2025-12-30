import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi";
import { JsonApiDataInterface } from "../../../core/jsonapi";
import { JsonApiServiceInterface } from "../../../core/jsonapi";
import { StripeSubscriptionModel } from "../../stripe-subscription/entities/stripe-subscription.model";
import { UsageRecord } from "../entities/usage-record.entity";
import { UsageRecordModel } from "../entities/usage-record.model";

@Injectable()
export class UsageRecordSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return UsageRecordModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      subscriptionId: "subscriptionId",
      meterId: "meterId",
      meterEventName: "meterEventName",
      quantity: "quantity",
      timestamp: (data: UsageRecord) => data.timestamp?.toISOString(),
      stripeEventId: "stripeEventId",
    };

    this.relationships = {
      subscription: {
        data: this.serialiserFactory.create(StripeSubscriptionModel),
      },
    };

    return super.create();
  }
}
