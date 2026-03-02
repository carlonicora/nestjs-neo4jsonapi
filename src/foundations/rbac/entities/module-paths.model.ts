import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { ModuleRelationshipPaths } from "./module-paths.entity";
import { mapModulePathsFromRow } from "./module-paths.map";
import { modulePathsMeta } from "./module-paths.meta";
import { ModulePathsSerialiser } from "../serialisers/module-paths.serialiser";

export const modulePathsModel: DataModelInterface<ModuleRelationshipPaths> = {
  ...modulePathsMeta,
  entity: undefined as unknown as ModuleRelationshipPaths,
  mapper: mapModulePathsFromRow as any,
  serialiser: ModulePathsSerialiser,
};
