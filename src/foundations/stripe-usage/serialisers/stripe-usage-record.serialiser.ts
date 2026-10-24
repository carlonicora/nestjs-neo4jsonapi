import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "../../../config/interfaces/base.config.interface";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi";
import { JsonApiDataInterface } from "../../../core/jsonapi";
import { JsonApiServiceInterface } from "../../../core/jsonapi";
import { StripeSubscriptionDescriptor } from "../../stripe-subscription/entities/stripe-subscription";
import { StripeUsageRecord } from "../entities/stripe-usage-record.entity";
import { StripeUsageRecordModel } from "../entities/stripe-usage-record.model";

@Injectable()
export class StripeUsageRecordSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return StripeUsageRecordModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      subscriptionId: "subscriptionId",
      meterId: "meterId",
      meterEventName: "meterEventName",
      quantity: "quantity",
      timestamp: (data: StripeUsageRecord) => data.timestamp?.toISOString(),
      stripeEventId: "stripeEventId",
    };

    this.relationships = {
      subscription: {
        data: this.serialiserFactory.create(StripeSubscriptionDescriptor.model),
      },
    };

    return super.create();
  }
}
