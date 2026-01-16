import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi/abstracts/abstract.jsonapi.serialiser";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi/factories/jsonapi.serialiser.factory";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiServiceInterface } from "../../../core/jsonapi/interfaces/jsonapi.service.interface";
import { authMeta } from "../../auth/entities/auth.meta";
import { UserDescriptor } from "../../user/entities/user";

@Injectable()
export class AuthSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, configService: ConfigService<BaseConfigInterface>) {
    super(serialiserFactory, configService);
  }

  get type(): string {
    return authMeta.endpoint;
  }

  get endpoint(): string {
    return `${authMeta.endpoint}/refreshtoken`;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      token: "token",
      refreshToken: "refreshToken",
      expiration: "expiration",
    };

    this.relationships = {
      user: {
        data: this.serialiserFactory.create(UserDescriptor.model),
      },
    };

    return super.create();
  }
}
