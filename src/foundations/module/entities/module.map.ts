import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { Module } from "../../module/entities/module.entity";

export const mapModule = (params: { data: any; record: any; entityFactory: EntityFactory }): Module => {
  const rawPermissions = JSON.parse(params.data.permissions ?? []);

  const permissions = {};
  for (const singlePermission of rawPermissions) {
    permissions[singlePermission["type"]] = singlePermission["value"];
  }

  return {
    ...mapEntity({ record: params.data }),
    name: params.data.name,

    permissions: permissions,
  };
};
