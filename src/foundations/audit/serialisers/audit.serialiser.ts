import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi/abstracts/abstract.jsonapi.serialiser";
import { DynamicRelationshipFactory } from "../../../core/jsonapi/factories/dynamic.relationship.factory";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi/factories/jsonapi.serialiser.factory";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiServiceInterface } from "../../../core/jsonapi/interfaces/jsonapi.service.interface";
import { auditMeta } from "../../audit/entities/audit.meta";
import { UserDescriptor } from "../../user/entities/user";

@Injectable()
export class AuditSerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(
    serialiserFactory: JsonApiSerialiserFactory,
    private readonly dynamicRelationshipFactory: DynamicRelationshipFactory,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super(serialiserFactory, configService);
  }

  get type(): string {
    return auditMeta.endpoint;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      auditType: "auditType",
    };

    const dynamicRel = this.dynamicRelationshipFactory.createDynamicRelationship(null);

    this.relationships = {
      user: {
        data: this.serialiserFactory.create(UserDescriptor.model),
      },
      audited: {
        data: dynamicRel,
        dynamicFactory: this.dynamicRelationshipFactory,
      },
    };

    return super.create();
  }
}
