import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { Feature } from "../../feature/entities/feature.entity";

export const mapFeature = (params: { data: any; record: any; entityFactory: EntityFactory }): Feature => {
  return {
    ...mapEntity({ record: params.data }),
    name: params.data.name,
    isCore: params.data.isCore ?? false,
    module: [],
  };
};
