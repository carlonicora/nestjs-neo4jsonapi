import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces";
import { AbstractJsonApiSerialiser } from "../../../core/jsonapi/abstracts/abstract.jsonapi.serialiser";
import { JsonApiSerialiserFactory } from "../../../core/jsonapi/factories/jsonapi.serialiser.factory";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiServiceInterface } from "../../../core/jsonapi/interfaces/jsonapi.service.interface";
import { Company } from "../../company/entities/company.entity";
import { companyMeta } from "../../company/entities/company.meta";
import { FeatureModel } from "../../feature/entities/feature.model";
import { ModuleModel } from "../../module/entities/module.model";
import { S3Service } from "../../s3/services/s3.service";

@Injectable()
export class CompanySerialiser extends AbstractJsonApiSerialiser implements JsonApiServiceInterface {
  constructor(
    serialiserFactory: JsonApiSerialiserFactory,
    protected readonly s3Service: S3Service,
    configService: ConfigService<BaseConfigInterface>,
  ) {
    super(serialiserFactory, configService);
  }

  get type(): string {
    return companyMeta.endpoint;
  }

  create(): JsonApiDataInterface {
    this.attributes = {
      name: "name",
      configurations: "configurations",
      logoUrl: "logo",
      logo: async (data: Company) => {
        if (!data.logo) return undefined;

        return await this.s3Service.generateSignedUrl({ key: data.logo, isPublic: true });
      },
      availableTokens: async (data: Company) => {
        if (data.availableTokens === undefined) return 0;
        return Number(data.availableTokens);
      },
      licenseExpirationDate: (data: Company) => data.licenseExpirationDate?.toISOString(),
    };

    this.relationships = {
      feature: {
        name: `features`,
        data: this.serialiserFactory.create(FeatureModel),
      },
      module: {
        name: `modules`,
        data: this.serialiserFactory.create(ModuleModel),
      },
    };

    return super.create();
  }
}
