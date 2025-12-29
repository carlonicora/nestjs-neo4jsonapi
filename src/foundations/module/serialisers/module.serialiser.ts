import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi/abstracts/abstract.jsonapi.serialiser";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi/factories/jsonapi.serialiser.factory";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiServiceInterface } from "../../../core/jsonapi/interfaces/jsonapi.service.interface";
import { moduleMeta } from "../../module/entities/module.meta";

@Injectable()
export class ModuleSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(serialiserFactory: JsonApiSerialiserFactory, configService: ConfigService<BaseConfigInterface>) {
    super(serialiserFactory, configService);
  }

  get type(): string {
    return moduleMeta.endpoint;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      name: "name",
    };

    this.meta = {
      permissions: {
        create: "create",
        read: "read",
        update: "update",
        delete: "delete",
      },
    };

    return super.create();
  }
}
