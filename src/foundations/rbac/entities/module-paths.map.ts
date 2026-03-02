import { ModuleRelationshipPaths } from "./module-paths.entity";

/**
 * Maps a moduleId and its extracted relationship path segments
 * into a ModuleRelationshipPaths entity.
 */
export const mapModulePathsFromRow = (row: { moduleId: string; paths: string[] }): ModuleRelationshipPaths => {
  return {
    id: row.moduleId,
    type: "module-paths",
    createdAt: new Date(),
    updatedAt: new Date(),
    moduleId: row.moduleId,
    paths: row.paths,
  };
};
