import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface as ConfigInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { AbstractJsonApiSerialiser } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiSerialiserFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiServiceInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookEvent } from "../entities/webhook-event.entity";
import { WebhookEventModel } from "../entities/webhook-event.model";

@Injectable()
export class WebhookEventSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, config: ConfigService<ConfigInterface>) {
    super(serialiserFactory, config);
  }

  get type(): string {
    return WebhookEventModel.type;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      stripeEventId: "stripeEventId",
      eventType: "eventType",
      livemode: "livemode",
      apiVersion: "apiVersion",
      status: "status",
      processedAt: (data: WebhookEvent) => data.processedAt?.toISOString(),
      error: "error",
      retryCount: "retryCount",
    };

    this.relationships = {};

    return super.create();
  }
}
