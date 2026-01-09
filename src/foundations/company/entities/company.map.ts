import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { Company } from "../../company/entities/company.entity";

export const mapCompany = (params: { data: any; record: any; entityFactory: EntityFactory }): Company => {
  return {
    ...mapEntity({ record: params.data }),
    name: params.data.name,
    configurations: params.data.configurations,
    logo: params.data.logo,
    logoUrl: params.data.logoUrl,
    monthlyTokens: params.data.monthlyTokens ?? 0,
    availableMonthlyTokens: params.data.availableMonthlyTokens ?? 0,
    availableExtraTokens: params.data.availableExtraTokens ?? 0,
    ownerEmail: params.data.ownerEmail,
    isActiveSubscription: params.data.isActiveSubscription,

    feature: [],
    module: [],
    configuration: undefined,
  };
};
