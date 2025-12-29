import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { AbstractJsonApiSerialiser } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiSerialiserFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiServiceInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { SubscriptionModel } from "../entities/subscription.model";
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
        data: this.serialiserFactory.create(SubscriptionModel),
      },
    };

    return super.create();
  }
}
