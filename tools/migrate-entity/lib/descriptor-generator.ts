/**
 * Entity Migration CLI - Descriptor Generator Module
 *
 * Generates new-style descriptor code from parsed entity data.
 */

import { findAndParseCypherRelationships } from "./ast-parser";
import {
  ComputedConfig,
  CypherRelationship,
  FieldConfig,
  GeneratedDescriptor,
  ParsedEntity,
  RelationshipConfig,
  S3TransformInfo,
} from "./types";

export interface GeneratorOptions {
  /** Path to the module directory for Cypher relationship extraction */
  modulePath?: string;
  /** Whether to use Cypher relationships instead of heuristics */
  useCypherRelationships?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Entity name for file naming (e.g., "key.concept") */
  entityName?: string;
}

/**
 * Generates the new descriptor code from parsed entity data.
 */
export function generateDescriptor(
  parsed: ParsedEntity,
  entityDir: string,
  options: GeneratorOptions = {},
): GeneratedDescriptor {
  const { meta, entityType, mapper, serialiser } = parsed;

  // Try to extract relationships from Cypher queries if module path provided
  let cypherRelationships: CypherRelationship[] = [];
  if (options.useCypherRelationships !== false && options.modulePath) {
    cypherRelationships = findAndParseCypherRelationships(options.modulePath, meta.nodeName);
    if (options.verbose && cypherRelationships.length > 0) {
      console.log(`  Found ${cypherRelationships.length} relationships from Cypher queries:`);
      for (const rel of cypherRelationships) {
        console.log(
          `    - ${rel.name}: ${rel.direction === "in" ? "<-" : ""}[:${rel.relationshipType}]${rel.direction === "out" ? "->" : ""} ${rel.relatedLabel}`,
        );
      }
    }
  }

  // Get S3 transforms from serialiser
  const s3Transforms = serialiser?.s3Transforms || [];

  // Build field configs with S3 transforms applied
  const fields = buildFieldConfigs(entityType, serialiser, mapper, s3Transforms);

  // Build computed configs
  const computed = buildComputedConfigs(mapper, serialiser);

  // Build relationship configs using Cypher relationships when available
  const relationships = buildRelationshipConfigs(serialiser, cypherRelationships, options.verbose);

  // Determine which services to include (only include S3Service if transforms are used)
  const rawServices = serialiser?.services || [];
  const services = s3Transforms.length > 0 ? rawServices : rawServices.filter((s) => s !== "S3Service");

  // Log S3 transforms if verbose
  if (options.verbose && s3Transforms.length > 0) {
    console.log(`  Auto-generated ${s3Transforms.length} S3 transform(s):`);
    for (const transform of s3Transforms) {
      console.log(`    - ${transform.fieldName}: ${transform.isArray ? "array" : "single"} URL signing`);
    }
  }

  // Warn about custom methods that may need manual migration (skip S3-related methods if transforms were generated)
  const s3TransformFields = new Set(s3Transforms.map((t) => t.fieldName));
  const s3RelatedMethods = ["getSignedUrl", "getSignedUrls", "generateSignedUrl", "signUrl", "signUrls"];

  if (serialiser?.customMethods && serialiser.customMethods.length > 0) {
    const unmigratableMethods = serialiser.customMethods.filter((method) => {
      // Skip S3-related methods if we have transforms for URL fields
      if (s3Transforms.length > 0 && s3RelatedMethods.some((s3m) => method.toLowerCase().includes(s3m.toLowerCase()))) {
        return false;
      }
      return true;
    });

    if (unmigratableMethods.length > 0) {
      console.warn(`    ⚠️  Serialiser has custom methods that may need manual migration:`);
      for (const method of unmigratableMethods) {
        console.warn(`      - ${method}() → Consider adding field transform`);
      }
    }
  }

  // Generate imports (pass entityName for correct file path in self-meta import)
  const imports = generateImports(parsed, relationships, entityDir, options.entityName, services);

  // Generate the descriptor code
  const code = generateDescriptorCode(meta, entityType.name, fields, computed, relationships, services);

  return { code, imports };
}

/**
 * Builds field configurations from entity type, serialiser, and mapper.
 */
function buildFieldConfigs(
  entityType: ParsedEntity["entityType"],
  serialiser: ParsedEntity["serialiser"],
  mapper: ParsedEntity["mapper"],
  s3Transforms: S3TransformInfo[] = [],
): FieldConfig[] {
  const fields: FieldConfig[] = [];

  // Get attribute names from serialiser (these are JSON:API attributes)
  const attributeNames = new Set(serialiser?.attributes.map((a) => a.name) || []);

  // Get meta names from serialiser (these go to meta)
  const metaNames = new Set(serialiser?.meta.map((m) => m.name) || []);

  // Get mapper field names for mapping
  const mapperFields = new Map(mapper?.fields.filter((f) => !f.isComputed).map((f) => [f.name, f]) || []);

  // Create a map of S3 transforms by field name
  const s3TransformMap = new Map(s3Transforms.map((t) => [t.fieldName, t]));

  // Process entity type fields
  for (const field of entityType.fields) {
    // Skip if this is a computed field (handled separately)
    const mapperField = mapperFields.get(field.name);
    if (mapper?.fields.some((f) => f.name === field.name && f.isComputed)) {
      continue;
    }

    // Determine if it's a meta field
    const isMeta = metaNames.has(field.name);

    // Determine if it's required (not optional and not a meta field)
    const isRequired = !field.optional && attributeNames.has(field.name);

    // Determine type (cypher type)
    const cypherType = mapToCypherType(field.type);

    // Check for default values (e.g., aiStatus)
    const defaultValue = getDefaultValue(field.name, mapper);

    // Check for S3 transforms
    const s3Transform = s3TransformMap.get(field.name);
    const transform = s3Transform ? generateS3TransformCode(field.name, s3Transform.isArray) : undefined;

    fields.push({
      name: field.name,
      type: cypherType,
      required: isRequired,
      default: defaultValue,
      meta: isMeta,
      transform,
    });
  }

  return fields;
}

/**
 * Generates S3 transform function code for a field.
 */
function generateS3TransformCode(fieldName: string, isArray: boolean): string {
  if (isArray) {
    // Array URL transform
    return `async (data, services) => {
        if (!data.${fieldName}?.length) return [];
        return Promise.all(
          data.${fieldName}.map((url: string) => services.S3Service.generateSignedUrl({ key: url })),
        );
      }`;
  } else {
    // Single URL transform
    return `async (data, services) => {
        if (!data.${fieldName}) return undefined;
        return await services.S3Service.generateSignedUrl({ key: data.${fieldName} });
      }`;
  }
}

/**
 * Builds computed field configurations from mapper.
 */
function buildComputedConfigs(
  mapper: ParsedEntity["mapper"],
  serialiser: ParsedEntity["serialiser"],
): ComputedConfig[] {
  const computed: ComputedConfig[] = [];

  if (!mapper) return computed;

  // Get meta names from serialiser
  const metaNames = new Set(serialiser?.meta.map((m) => m.name) || []);

  for (const field of mapper.fields.filter((f) => f.isComputed)) {
    computed.push({
      name: field.name,
      compute: field.mapping,
      meta: metaNames.has(field.name),
    });
  }

  return computed;
}

/**
 * Builds relationship configurations from serialiser, using Cypher relationships when available.
 */
function buildRelationshipConfigs(
  serialiser: ParsedEntity["serialiser"],
  cypherRelationships: CypherRelationship[] = [],
  verbose?: boolean,
): RelationshipConfig[] {
  const relationships: RelationshipConfig[] = [];

  if (!serialiser) return relationships;

  // Create a map of Cypher relationships by name for quick lookup
  const cypherMap = new Map<string, CypherRelationship>();
  for (const rel of cypherRelationships) {
    cypherMap.set(rel.name, rel);
  }

  for (const rel of serialiser.relationships) {
    // Convert Model name to meta name (e.g., UserModel -> userMeta, authorMeta)
    const modelMeta = modelToMetaName(rel.name, rel.modelImport);

    // Check if we have Cypher-extracted relationship info
    const cypherRel = cypherMap.get(rel.name);

    let direction: "in" | "out";
    let relationship: string;
    let contextKey: string | undefined;

    if (cypherRel) {
      // Use Cypher-extracted values (from actual database queries)
      direction = cypherRel.direction;
      relationship = cypherRel.relationshipType;
      // Keep contextKey heuristic for author relationship
      contextKey = rel.name === "author" ? "userId" : undefined;

      if (verbose) {
        console.log(
          `    Using Cypher for '${rel.name}': ${direction === "in" ? "<-" : ""}[:${relationship}]${direction === "out" ? "->" : ""}`,
        );
      }
    } else {
      // Fall back to heuristics when no Cypher info available
      const inferred = inferRelationshipDetails(rel.name);
      direction = inferred.direction;
      relationship = inferred.relationship;
      contextKey = inferred.contextKey;

      if (verbose) {
        console.log(
          `    Using heuristic for '${rel.name}': ${direction === "in" ? "<-" : ""}[:${relationship}]${direction === "out" ? "->" : ""} (no Cypher match)`,
        );
      }
    }

    // Determine cardinality from dtoKey (plural = many)
    const cardinality = rel.dtoKey && rel.dtoKey.endsWith("s") ? "many" : "one";

    relationships.push({
      name: rel.name,
      model: modelMeta,
      direction,
      relationship,
      cardinality,
      dtoKey: rel.dtoKey,
      contextKey,
    });
  }

  return relationships;
}

/**
 * Maps TypeScript type to Cypher type.
 * Handles both scalar types and array types.
 */
function mapToCypherType(tsType: string): string {
  // Handle array types first (e.g., string[], number[])
  if (tsType.endsWith("[]")) {
    const baseType = tsType.slice(0, -2);
    const mappedBase = mapScalarToCypherType(baseType);
    return `${mappedBase}[]`;
  }

  return mapScalarToCypherType(tsType);
}

/**
 * Maps a scalar TypeScript type to Cypher type.
 */
function mapScalarToCypherType(tsType: string): string {
  const typeMap: Record<string, string> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    Date: "datetime",
    object: "json",
  };

  return typeMap[tsType] || "string";
}

/**
 * Gets default value for a field if known.
 */
function getDefaultValue(fieldName: string, mapper: ParsedEntity["mapper"]): string | undefined {
  // Known defaults
  const knownDefaults: Record<string, string> = {
    aiStatus: "AiStatus.Pending",
  };

  return knownDefaults[fieldName];
}

/**
 * Converts Model/Descriptor import name to model reference.
 * Returns either a meta variable name or a Descriptor.model reference.
 */
function modelToMetaName(relName: string, modelImport: string): string {
  // Special cases for framework-provided relationships
  if (relName === "author") return "authorMeta";
  if (relName === "user" || relName === "editors") return "userMeta";

  // Already migrated entity: CompanyDescriptor -> CompanyDescriptor.model
  if (modelImport.endsWith("Descriptor")) {
    return `${modelImport}.model`;
  }

  // Old pattern: UserModel -> userMeta
  const baseName = modelImport.replace("Model", "").toLowerCase();
  return `${baseName}Meta`;
}

/**
 * Infers relationship details based on relationship name.
 */
function inferRelationshipDetails(relName: string): {
  direction: "in" | "out";
  relationship: string;
  contextKey?: string;
} {
  // Known patterns
  const patterns: Record<string, { direction: "in" | "out"; relationship: string; contextKey?: string }> = {
    author: { direction: "in", relationship: "PUBLISHED", contextKey: "userId" },
    user: { direction: "out", relationship: "ACCESSIBLE_BY" },
    topic: { direction: "out", relationship: "RELEVANT_FOR" },
    expertise: { direction: "out", relationship: "RELEVANT_FOR" },
    company: { direction: "out", relationship: "BELONGS_TO" },
  };

  return patterns[relName] || { direction: "out", relationship: "RELATED_TO" };
}

/**
 * Generates import statements for the descriptor.
 *
 * Import grouping:
 * - Group 1: Framework imports (single line from @carlonicora/nestjs-neo4jsonapi)
 * - Group 2: External type imports (@only35/shared, etc.)
 * - Group 3: Entity-specific imports (src/features/...)
 * - Group 4: Self-meta import (relative path)
 */
function generateImports(
  parsed: ParsedEntity,
  relationships: RelationshipConfig[],
  entityDir: string,
  entityName?: string,
  services: string[] = [],
): string[] {
  const { meta } = parsed;

  // Collect all framework imports into a single barrel import
  const frameworkImports = new Set<string>(["defineEntity", "Entity"]);

  // Add service imports (they come from the framework package)
  for (const service of services) {
    frameworkImports.add(service);
  }

  // Check if AiStatus is needed
  const hasAiStatus = parsed.entityType.fields.some((f) => f.name === "aiStatus");
  if (hasAiStatus) {
    frameworkImports.add("AiStatus");
  }

  // Collect relationship metas that come from the framework package
  const externalImports: string[] = [];
  const featureImports: string[] = [];

  for (const rel of relationships) {
    const modelRef = rel.model;

    // Already-migrated entity: CompanyDescriptor.model -> need to import CompanyDescriptor
    if (modelRef.endsWith(".model")) {
      const descriptorName = modelRef.replace(".model", "");
      const descriptorImport = findDescriptorImport(parsed, descriptorName);
      if (descriptorImport) {
        featureImports.push(descriptorImport);
      }
      continue;
    }

    // Meta-based reference: xxxMeta
    const baseName = modelRef.replace("Meta", "");

    // Known foundation metas and their import paths
    const foundationMetaPaths: Record<string, string> = {
      user: "../../user/entities/user.meta",
      author: "../../user/entities/user.meta",
      owner: "../../user/entities/user.meta",
      assignee: "../../user/entities/user.meta",
      company: "../../company/entities/company.meta",
    };

    if (foundationMetaPaths[baseName]) {
      // Foundation-provided metas: import from their meta files
      featureImports.push(`import { ${modelRef} } from "${foundationMetaPaths[baseName]}";`);
    } else {
      // Feature-specific metas need separate imports
      const metaImport = findMetaImport(parsed, modelRef);
      if (metaImport) {
        featureImports.push(metaImport);
      }
    }
  }

  // Add relationship type imports from entity type definition
  // Collect types that need imports from original entity or foundation paths
  const relationshipTypeImports: string[] = [];

  // Known foundation entity types and their import paths
  const foundationEntityPaths: Record<string, string> = {
    Company: "../../company/entities/company",
    User: "../../user/entities/user",
    // Alias types map to User
    Author: "../../user/entities/user",
    Owner: "../../user/entities/user",
    Assignee: "../../user/entities/user",
  };

  for (const field of parsed.entityType.relationshipFields) {
    const typeName = field.type.replace("[]", "");

    // For known foundation types, generate type-only imports
    if (foundationEntityPaths[typeName]) {
      const importPath = foundationEntityPaths[typeName];
      relationshipTypeImports.push(`import type { ${typeName} } from "${importPath}";`);
      continue;
    }

    // For all other relationship types, find the original import from entity
    // Use type-only imports to avoid circular dependencies
    for (const imp of parsed.entityType.imports) {
      // Skip imports from the package barrel - these should use internal paths
      if (imp.includes("@carlonicora/nestjs-neo4jsonapi")) {
        continue;
      }

      // Match imports like "import { Feature } from ..." or "import { Module } from ..."
      if (imp.includes(`{ ${typeName} }`) || imp.includes(`{ ${typeName},`) || imp.includes(`, ${typeName} }`)) {
        // Convert to type-only import
        const typeImport = imp.replace(/^import\s+\{/, "import type {");
        relationshipTypeImports.push(typeImport);
        break;
      }
    }
  }

  // Build the imports array
  const imports: string[] = [];

  // Group 1: Single barrel import from framework
  // Use internal imports (../../../common) to avoid circular dependency when the package
  // barrel re-exports from ./foundations which tries to load this entity again
  const frameworkImportList = Array.from(frameworkImports).sort();
  imports.push(`import {\n  ${frameworkImportList.join(",\n  ")},\n} from "../../../common";`);

  // Group 2: External type imports (from original entity imports that aren't framework)
  for (const imp of parsed.entityType.imports) {
    if (imp.includes("@only35/shared") || (imp.includes("@") && !imp.includes("@carlonicora/nestjs-neo4jsonapi"))) {
      externalImports.push(imp);
    }
  }
  if (externalImports.length > 0) {
    imports.push(...[...new Set(externalImports)]);
  }

  // Group 3: Relationship type imports (Feature, Module, etc.) from original entity
  // Use "import type" to avoid runtime circular dependencies - these are only needed for TypeScript types
  if (relationshipTypeImports.length > 0) {
    const typeOnlyImports = [...new Set(relationshipTypeImports)].map((imp) =>
      imp.startsWith("import type ") ? imp : imp.replace(/^import\s+/, "import type "),
    );
    imports.push(...typeOnlyImports);
  }

  // Group 4: Entity-specific imports (src/features/...)
  for (const imp of parsed.entityType.imports) {
    if (imp.includes("src/features/") && !imp.includes(".meta")) {
      featureImports.push(imp);
    }
  }
  if (featureImports.length > 0) {
    imports.push(...[...new Set(featureImports)]);
  }

  // Group 4: Self-meta import (use entityName for file path, nodeName for variable name)
  const metaName = `${meta.nodeName}Meta`;
  const metaFilePath = entityName || meta.nodeName;
  imports.push(`import { ${metaName} } from "./${metaFilePath}.meta";`);

  return imports;
}

/**
 * Finds the meta import statement for a given meta name.
 * Derives the path from serialiser model imports by converting .model to .meta
 */
function findMetaImport(parsed: ParsedEntity, metaName: string): string | null {
  // Check if serialiser already imports this meta directly
  if (parsed.serialiser) {
    for (const imp of parsed.serialiser.imports) {
      if (imp.includes(`.meta"`) || imp.includes(`.meta'`)) {
        // Check if this import contains the meta we're looking for
        const importMatch = imp.match(/import\s*\{([^}]+)\}/);
        if (importMatch) {
          const importedNames = importMatch[1].split(",").map((s) => s.trim());
          if (importedNames.includes(metaName)) {
            // Return just this import
            return imp.replace(/import\s*\{[^}]+\}/, `import { ${metaName} }`);
          }
        }
      }
    }
  }

  const baseName = metaName.replace("Meta", "");

  // Framework-provided metas
  if (["author", "user", "company"].includes(baseName)) {
    return `import { ${metaName} } from "@carlonicora/nestjs-neo4jsonapi";`;
  }

  // Try to derive meta import from serialiser model imports
  // e.g., FeatureModel from ".../feature.model" -> featureMeta from ".../feature.meta"
  if (parsed.serialiser) {
    const modelName = baseName.charAt(0).toUpperCase() + baseName.slice(1) + "Model";
    for (const imp of parsed.serialiser.imports) {
      if (imp.includes(modelName)) {
        // Extract path and convert to meta path
        const pathMatch = imp.match(/from\s+["']([^"']+)["']/);
        if (pathMatch) {
          const modelPath = pathMatch[1];
          const metaPath = modelPath.replace(/\.model$/, ".meta");
          return `import { ${metaName} } from "${metaPath}";`;
        }
      }
    }
  }

  // Last resort: construct path heuristically from known foundations structure
  if (baseName === "topic") {
    return `import { ${metaName} } from "src/features/topic/entities/topic.meta";`;
  }
  if (baseName === "expertise") {
    return `import { ${metaName} } from "src/features/expertise/entities/expertise.meta";`;
  }
  if (baseName === "feature") {
    return `import { ${metaName} } from "../../feature/entities/feature.meta";`;
  }
  if (baseName === "module") {
    return `import { ${metaName} } from "../../module/entities/module.meta";`;
  }
  if (baseName === "role") {
    return `import { ${metaName} } from "../../role/entities/role.meta";`;
  }
  if (baseName === "configuration") {
    return `import { ${metaName} } from "../../configuration/entities/configuration.meta";`;
  }
  if (baseName === "referencerole") {
    return `import { ${metaName} } from "../../reference-role/entities/reference.role.meta";`;
  }

  // Generic fallback: assume foundation-style path
  return `import { ${metaName} } from "../../${baseName}/entities/${baseName}.meta";`;
}

/**
 * Finds the descriptor import statement for an already-migrated entity.
 * Looks for existing imports like: import { CompanyDescriptor } from "../../company/entities/company";
 */
function findDescriptorImport(parsed: ParsedEntity, descriptorName: string): string | null {
  // Check if serialiser already imports this descriptor
  if (parsed.serialiser) {
    for (const imp of parsed.serialiser.imports) {
      if (imp.includes(descriptorName)) {
        // Extract the path and return just this descriptor import
        const pathMatch = imp.match(/from\s+["']([^"']+)["']/);
        if (pathMatch) {
          return `import { ${descriptorName} } from "${pathMatch[1]}";`;
        }
      }
    }
  }

  // Derive path from descriptor name (e.g., CompanyDescriptor -> ../../company/entities/company)
  const baseName = descriptorName.replace("Descriptor", "").toLowerCase();
  return `import { ${descriptorName} } from "../../${baseName}/entities/${baseName}";`;
}

/**
 * Generates the complete descriptor code.
 */
function generateDescriptorCode(
  meta: ParsedEntity["meta"],
  entityName: string,
  fields: FieldConfig[],
  computed: ComputedConfig[],
  relationships: RelationshipConfig[],
  services: string[] = [],
): string {
  const descriptorName = `${meta.labelName}Descriptor`;
  const metaName = `${meta.nodeName}Meta`;

  let code = `
/**
 * ${meta.labelName} Entity Descriptor
 *
 * Single source of truth for the ${meta.labelName} entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 */
export const ${descriptorName} = defineEntity<${entityName}>()({
  ...${metaName},
`;

  // Add injectServices if services exist
  if (services.length > 0) {
    code += `
  injectServices: [${services.join(", ")}],
`;
  }

  // Add fields
  if (fields.length > 0) {
    code += `
  // Field definitions
  fields: {
`;
    for (const field of fields) {
      if (field.transform) {
        // Multi-line format for fields with transforms
        code += `    ${field.name}: {\n`;
        code += `      type: "${field.type}",\n`;
        if (field.required) code += `      required: true,\n`;
        if (field.default) code += `      default: ${field.default},\n`;
        if (field.meta) code += `      meta: true,\n`;
        code += `      transform: ${field.transform},\n`;
        code += `    },\n`;
      } else {
        // Single-line format for simple fields
        code += `    ${field.name}: { type: "${field.type}"`;
        if (field.required) code += `, required: true`;
        if (field.default) code += `, default: ${field.default}`;
        if (field.meta) code += `, meta: true`;
        code += ` },\n`;
      }
    }
    code += `  },
`;
  }

  // Add computed fields
  if (computed.length > 0) {
    code += `
  // Computed fields
  computed: {
`;
    for (const comp of computed) {
      code += `    ${comp.name}: {\n`;
      code += `      compute: (params) => ${comp.compute},\n`;
      if (comp.meta) code += `      meta: true,\n`;
      code += `    },\n`;
    }
    code += `  },
`;
  }

  // Add relationships
  if (relationships.length > 0) {
    code += `
  // Relationship definitions
  relationships: {
`;
    for (const rel of relationships) {
      code += `    ${rel.name}: {\n`;
      code += `      model: ${rel.model},\n`;
      code += `      direction: "${rel.direction}",\n`;
      code += `      relationship: "${rel.relationship}",\n`;
      code += `      cardinality: "${rel.cardinality}",\n`;
      if (rel.required === false) code += `      required: false,\n`;
      if (rel.contextKey) code += `      contextKey: "${rel.contextKey}",\n`;
      if (rel.dtoKey) code += `      dtoKey: "${rel.dtoKey}",\n`;
      // Add edge fields if present
      if (rel.fields && rel.fields.length > 0) {
        code += `      fields: [\n`;
        for (const field of rel.fields) {
          code += `        { name: "${field.name}", type: "${field.type}"`;
          if (field.required) code += `, required: true`;
          code += ` },\n`;
        }
        code += `      ],\n`;
      }
      code += `    },\n`;
    }
    code += `  },
`;
  }

  code += `});

// Type export for the descriptor
export type ${descriptorName}Type = typeof ${descriptorName};
`;

  return code;
}

/**
 * Generates the meta file content for an entity.
 *
 * Creates a standalone meta file matching the pattern:
 * ```typescript
 * import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";
 * export const {entity}Meta: DataMeta = { type, endpoint, nodeName, labelName };
 * ```
 */
export function generateMetaFile(meta: ParsedEntity["meta"]): string {
  const metaName = `${meta.nodeName}Meta`;

  return `import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const ${metaName}: DataMeta = {
  type: "${meta.type}",
  endpoint: "${meta.endpoint}",
  nodeName: "${meta.nodeName}",
  labelName: "${meta.labelName}",
};
`;
}

/**
 * Generates the complete new entity file content.
 */
export function generateEntityFile(parsed: ParsedEntity, entityDir: string, options: GeneratorOptions = {}): string {
  const descriptor = generateDescriptor(parsed, entityDir, options);

  // Start with imports - extend with alias-related imports
  const imports = [...descriptor.imports];
  if (parsed.aliasModels.length > 0) {
    // Add defineEntityAlias to the framework imports (already in first import line)
    const firstImport = imports[0];
    if (firstImport && firstImport.includes("defineEntity")) {
      imports[0] = firstImport.replace("defineEntity,", "defineEntity,\n  defineEntityAlias,");
    }

    // Add alias meta imports to the self-meta import line
    // The self-meta import is the one that imports from "./{entityName}.meta" (the last import added by generateImports)
    const selfMetaPattern = new RegExp(`from\\s+["']\\.\\/[^"']+\\.meta["']`);
    const metaImportIndex = imports.findIndex((imp) => selfMetaPattern.test(imp));
    if (metaImportIndex !== -1) {
      const existingMetaImport = imports[metaImportIndex];
      const aliasMetaNames = parsed.aliasModels.map((a) => a.metaName);
      const baseMeta = `${parsed.meta.nodeName}Meta`;

      // Reconstruct meta import with all metas
      const allMetas = [baseMeta, ...aliasMetaNames];
      const pathMatch = existingMetaImport.match(/from\s+["']([^"']+)["']/);
      if (pathMatch) {
        imports[metaImportIndex] = `import { ${allMetas.join(", ")} } from "${pathMatch[1]}";`;
      }
    }
  }

  let content = imports.join("\n") + "\n\n";

  // Add the entity type definition (keep from original)
  content += generateEntityTypeDefinition(parsed);
  content += "\n";

  // Add the descriptor
  content += descriptor.code;

  // Add alias descriptors if any
  if (parsed.aliasModels.length > 0) {
    content += generateAliasDescriptors(parsed);
  }

  return content;
}

/**
 * Generates alias descriptor exports for entities with alias models.
 *
 * Example output:
 * ```typescript
 * export const OwnerDescriptor = defineEntityAlias(UserDescriptor, ownerMeta);
 * export const AuthorDescriptor = defineEntityAlias(UserDescriptor, authorMeta);
 * ```
 */
function generateAliasDescriptors(parsed: ParsedEntity): string {
  const baseDescriptorName = `${parsed.meta.labelName}Descriptor`;
  let code = "\n// Alias descriptors for relationship endpoints\n";

  for (const alias of parsed.aliasModels) {
    code += `export const ${alias.descriptorName} = defineEntityAlias(${baseDescriptorName}, ${alias.metaName});\n`;
  }

  return code;
}

/**
 * Generates the entity type definition from parsed data.
 */
function generateEntityTypeDefinition(parsed: ParsedEntity): string {
  const { entityType, meta } = parsed;

  let code = `/**
 * ${meta.labelName} Entity Type
 */
export type ${entityType.name} = Entity & {\n`;

  // Add scalar fields
  for (const field of entityType.fields) {
    const optional = field.optional ? "?" : "";
    code += `  ${field.name}${optional}: ${field.type};\n`;
  }

  // Add blank line before relationship fields if both exist
  if (entityType.fields.length > 0 && entityType.relationshipFields.length > 0) {
    code += `\n`;
  }

  // Add relationship fields (Company, User, Topic[], etc.)
  for (const field of entityType.relationshipFields) {
    const optional = field.optional ? "?" : "";
    code += `  ${field.name}${optional}: ${field.type};\n`;
  }

  code += `};\n`;

  return code;
}
