import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi/abstracts/abstract.jsonapi.serialiser";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi/factories/jsonapi.serialiser.factory";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiServiceInterface } from "../../../core/jsonapi/interfaces/jsonapi.service.interface";
import { notificationMeta } from "../../notification/entities/notification.meta";
import { UserDescriptor } from "../../user/entities/user";

@Injectable()
export class NotificationSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, configService: ConfigService<BaseConfigInterface>) {
    super(serialiserFactory, configService);
  }

  get type(): string {
    return notificationMeta.endpoint;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      notificationType: "notificationType",
      isRead: "isRead",
      message: "message",
      actionUrl: "actionUrl",
    };

    this.relationships = {
      user: {
        name: `actor`,
        data: this.serialiserFactory.create(UserDescriptor.model),
      },
    };

    return super.create();
  }
}
