import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { PermissionMapping } from "./permission-mapping.entity";
import { mapPermissionMappingFromRow } from "./permission-mapping.map";
import { permissionMappingMeta } from "./permission-mapping.meta";
import { PermissionMappingSerialiser } from "../serialisers/permission-mapping.serialiser";

export const permissionMappingModel: DataModelInterface<PermissionMapping> = {
  ...permissionMappingMeta,
  entity: undefined as unknown as PermissionMapping,
  mapper: mapPermissionMappingFromRow as any,
  serialiser: PermissionMappingSerialiser,
};
