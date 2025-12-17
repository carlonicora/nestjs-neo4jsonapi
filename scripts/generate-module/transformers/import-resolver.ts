import * as path from "path";

/**
 * Foundation package name constant
 */
export const FOUNDATION_PACKAGE = "@carlonicora/nestjs-neo4jsonapi";

/**
 * Check if a directory represents a foundation import (from the package)
 *
 * @param directory - The directory string from relationship definition
 * @returns True if this should import from the foundation package
 *
 * @example
 * isFoundationImport("@foundation") // true
 * isFoundationImport("features/campaign") // false
 */
export function isFoundationImport(directory: string): boolean {
  return directory === "@foundation" || directory.startsWith("@foundation/");
}

/**
 * Check if a related entity uses the NEW structure (Descriptor pattern)
 *
 * IMPORTANT: As of the circular dependency fix, we ALWAYS generate .meta.ts files
 * for all entities. This means all entities now use the OLD structure (meta pattern)
 * to avoid circular imports between entities that reference each other.
 *
 * @param params - Directory and module name of the related entity
 * @returns Always false - all entities now use meta pattern
 *
 * @deprecated This function now always returns false. All entities use meta pattern.
 */
export function isNewEntityStructure(params: { directory: string; moduleName: string }): boolean {
  // Always return false - we now generate .meta.ts files for ALL entities
  // This prevents circular dependencies when entities reference each other
  void params; // Suppress unused parameter warning
  return false;
}

/**
 * Get the model reference string for a relationship
 *
 * @param params - Entity name and structure type
 * @returns Model reference string for use in relationship definition
 *
 * @example
 * getModelReference({ isNewStructure: false, entityName: "User", variantName: "owner" })
 * // Returns: "ownerMeta"
 *
 * getModelReference({ isNewStructure: true, entityName: "Character" })
 * // Returns: "CharacterDescriptor.model"
 */
export function getModelReference(params: {
  isNewStructure: boolean;
  entityName: string;
  variantName?: string;
}): string {
  const { isNewStructure, entityName, variantName } = params;

  if (isNewStructure) {
    return `${entityName}Descriptor.model`;
  } else {
    // OLD structure: use variant name if provided, otherwise entity name
    const baseName = variantName || entityName;
    return `${baseName.charAt(0).toLowerCase()}${baseName.slice(1)}Meta`;
  }
}

/**
 * Get the Descriptor name for NEW structure entities
 *
 * @param entityName - PascalCase entity name
 * @returns Descriptor name (e.g., "CharacterDescriptor")
 */
export function getDescriptorName(entityName: string): string {
  return `${entityName}Descriptor`;
}

/**
 * Resolve relative import path between two modules
 *
 * @param params - From and to directories and modules
 * @returns Relative import path
 *
 * @example
 * From: src/features/comment
 * To: src/foundations/user
 * Result: "../../foundations/user"
 */
export function resolveImportPath(params: {
  fromDir: string;
  fromModule: string;
  toDir: string;
  toModule: string;
}): string {
  const { fromDir, fromModule, toDir, toModule } = params;

  // If in same directory, just go up one level and into the module
  if (fromDir === toDir) {
    return `../${toModule}`;
  }

  // Different directories: go up to src, then down to target
  // From: src/features/comment → need to go up 2 levels to reach src
  // To: src/foundations/user → then go down into foundations/user
  const upLevels = 2; // Always 2: one for module folder, one for directory folder
  const up = "../".repeat(upLevels);
  const down = `${toDir}/${toModule}`;

  return `${up}${down}`;
}

/**
 * Resolve import path for entity file
 *
 * @param params - From and to module info
 * @returns Import path to entity file
 *
 * @example
 * resolveEntityImportPath({ fromDir: "features", fromModule: "comment", toDir: "foundations", toModule: "user" })
 * // Returns: "../../foundations/user/entities/user.entity"
 */
export function resolveEntityImportPath(params: {
  fromDir: string;
  fromModule: string;
  toDir: string;
  toModule: string;
}): string {
  const basePath = resolveImportPath(params);
  return `${basePath}/entities/${params.toModule}.entity`;
}

/**
 * Resolve import path for meta file
 *
 * @param params - From and to module info
 * @returns Import path to meta file
 *
 * @example
 * resolveMetaImportPath({ fromDir: "features", fromModule: "comment", toDir: "foundations", toModule: "user" })
 * // Returns: "../../foundations/user/entities/user.meta"
 */
export function resolveMetaImportPath(params: {
  fromDir: string;
  fromModule: string;
  toDir: string;
  toModule: string;
}): string {
  const basePath = resolveImportPath(params);
  return `${basePath}/entities/${params.toModule}.meta`;
}

/**
 * Resolve import path for DTO file
 *
 * @param params - From and to module info
 * @returns Import path to DTO file
 *
 * @example
 * resolveDtoImportPath({ fromDir: "features", fromModule: "comment", toDir: "features", toModule: "discussion" })
 * // Returns: "../discussion/dtos/discussion.dto"
 */
export function resolveDtoImportPath(params: {
  fromDir: string;
  fromModule: string;
  toDir: string;
  toModule: string;
}): string {
  const basePath = resolveImportPath(params);
  return `${basePath}/dtos/${params.toModule}.dto`;
}

/**
 * Resolve import path relative to module root
 * Used for imports within the same module
 *
 * @param subpath - Subpath within module (e.g., "entities/comment", "services/comment.service")
 * @returns Relative import path
 *
 * @example
 * resolveModuleInternalPath("entities/comment")
 * // Returns: "../entities/comment"
 */
export function resolveModuleInternalPath(subpath: string): string {
  return `../${subpath}`;
}

// ============================================================================
// NEW Structure Import Path Functions
// ============================================================================

/**
 * Resolve import path for NEW structure entity file
 * NEW structure uses absolute paths from src and no .entity suffix
 *
 * @param params - Directory and module info
 * @returns Absolute import path for entity (e.g., "src/features/character/entities/character")
 *
 * @example
 * resolveNewEntityImportPath({ directory: "features", moduleName: "character" })
 * // Returns: "src/features/character/entities/character"
 */
export function resolveNewEntityImportPath(params: { directory: string; moduleName: string }): string {
  const { directory, moduleName } = params;

  if (isFoundationImport(directory)) {
    // Foundation: use package path (when foundations are migrated to NEW structure)
    return `src/foundations/${moduleName}/entities/${moduleName}`;
  }

  return `src/${directory}/${moduleName}/entities/${moduleName}`;
}

/**
 * Resolve import path for NEW structure DTO file
 *
 * @param params - Directory and module info
 * @returns Absolute import path for DTO (e.g., "src/features/character/dtos/character.dto")
 */
export function resolveNewDtoImportPath(params: { directory: string; moduleName: string }): string {
  const { directory, moduleName } = params;

  if (isFoundationImport(directory)) {
    return `src/foundations/${moduleName}/dtos/${moduleName}.dto`;
  }

  return `src/${directory}/${moduleName}/dtos/${moduleName}.dto`;
}
