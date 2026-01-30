import { TemplateData, DescriptorRelationship } from "../types/template-data.interface";
import { isFoundationImport, FOUNDATION_PACKAGE } from "../transformers/import-resolver";

/**
 * Get the entity type import path
 *
 * For foundation entities: imports from the package
 * For feature entities: relative path to entity file
 */
function getEntityImportPath(rel: DescriptorRelationship): string {
  return isFoundationImport(rel.relatedEntity.directory)
    ? FOUNDATION_PACKAGE
    : `src/${rel.relatedEntity.directory}/${rel.relatedEntity.kebabCase}/entities/${rel.relatedEntity.kebabCase}`;
}

/**
 * Get the meta import path
 *
 * For foundation entities: imports from the package (metas are re-exported)
 * For feature entities: relative path to meta file
 */
function getMetaImportPath(rel: DescriptorRelationship): string {
  return isFoundationImport(rel.relatedEntity.directory)
    ? FOUNDATION_PACKAGE
    : `src/${rel.relatedEntity.directory}/${rel.relatedEntity.kebabCase}/entities/${rel.relatedEntity.kebabCase}.meta`;
}

/**
 * Generate entity file content (Type + Descriptor)
 *
 * This is the most critical file - it defines both the TypeScript type
 * and the descriptor using defineEntity()
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generateEntityFile(data: TemplateData): string {
  const { names, fields, relationships } = data;

  // Build imports
  const libraryImports = ["defineEntity", "Entity"];
  if (data.isCompanyScoped) {
    libraryImports.push("Company");
  }

  // All entities use meta pattern to avoid circular dependencies
  // Entity type imports (grouped by path) - for type annotations
  const entityImportsByPath = new Map<string, string[]>();
  const processedEntities = new Set<string>();

  for (const rel of relationships) {
    // Skip self-referential relationships - the type is defined in this same file
    if (rel.relatedEntity.name === names.pascalCase) {
      continue;
    }
    if (!processedEntities.has(rel.relatedEntity.name)) {
      processedEntities.add(rel.relatedEntity.name);
      const importPath = getEntityImportPath(rel);
      if (!entityImportsByPath.has(importPath)) {
        entityImportsByPath.set(importPath, []);
      }
      entityImportsByPath.get(importPath)!.push(rel.relatedEntity.name);
    }
  }

  // Meta imports (grouped by path) - for relationship model references
  const metaImportsByPath = new Map<string, string[]>();
  const processedMetas = new Set<string>();

  for (const rel of relationships) {
    // Skip self-referential relationships - own meta is imported separately at the end
    if (rel.relatedEntity.name === names.pascalCase) {
      continue;
    }
    // Model is like "userMeta", "ownerMeta", "campaignMeta", etc.
    if (!processedMetas.has(rel.model)) {
      processedMetas.add(rel.model);
      const importPath = getMetaImportPath(rel);
      if (!metaImportsByPath.has(importPath)) {
        metaImportsByPath.set(importPath, []);
      }
      metaImportsByPath.get(importPath)!.push(rel.model);
    }
  }

  // Build field definitions for descriptor
  const fieldDefinitions = fields
    .map((field) => {
      const parts: string[] = [];
      parts.push(`type: "${field.type}"`);
      if (field.required) {
        parts.push(`required: true`);
      }
      return `    ${field.name}: { ${parts.join(", ")} },`;
    })
    .join("\n");

  // Build relationship definitions for descriptor
  const relationshipDefinitions = relationships
    .map((rel) => {
      const parts: string[] = [];
      parts.push(`model: ${rel.model}`);
      parts.push(`direction: "${rel.direction}"`);
      parts.push(`relationship: "${rel.relationship}"`);
      parts.push(`cardinality: "${rel.cardinality}"`);

      // Add required: false for optional single relationships (uses OPTIONAL MATCH in queries)
      if (!rel.required) {
        parts.push(`required: false`);
      }

      if (rel.contextKey) {
        parts.push(`contextKey: "${rel.contextKey}"`);
      }
      if (rel.dtoKey) {
        parts.push(`dtoKey: "${rel.dtoKey}"`);
      }

      // Add relationship property fields if present
      if (rel.fields && rel.fields.length > 0) {
        const fieldsDef = rel.fields
          .map((f) => `{ name: "${f.name}", type: "${f.type}", required: ${f.required} }`)
          .join(", ");
        parts.push(`fields: [${fieldsDef}]`);
      }

      return `    ${rel.key}: {\n      ${parts.join(",\n      ")},\n    },`;
    })
    .join("\n");

  // Build all import lines
  const importLines: string[] = [];

  // Library imports (always first)
  importLines.push(`import { ${libraryImports.join(", ")} } from "@carlonicora/nestjs-neo4jsonapi";`);

  // Entity type imports (for type annotations in the type definition)
  for (const [importPath, items] of entityImportsByPath.entries()) {
    importLines.push(`import { ${items.join(", ")} } from "${importPath}";`);
  }

  // Meta imports (for relationship model references)
  for (const [importPath, items] of metaImportsByPath.entries()) {
    importLines.push(`import { ${items.join(", ")} } from "${importPath}";`);
  }

  // Own meta import (for spreading into descriptor)
  importLines.push(`import { ${names.camelCase}Meta } from "./${names.kebabCase}.meta";`);

  return `${importLines.join("\n")}

/**
 * ${names.pascalCase} Entity Type
 */
export type ${names.pascalCase} = Entity & {
${fields
  .map((field) => {
    const optional = !field.required ? "?" : "";
    return `  ${field.name}${optional}: ${field.tsType};`;
  })
  .join("\n")}
${data.isCompanyScoped ? "  company: Company;\n" : ""}${relationships
  .map((rel) => {
    const optional = !rel.required ? "?" : "";
    const type = rel.cardinality === "many" ? `${rel.relatedEntity.name}[]` : rel.relatedEntity.name;
    return `  ${rel.key}${optional}: ${type};`;
  })
  .join("\n")}
};

/**
 * ${names.pascalCase} Entity Descriptor
 *
 * Single source of truth for the ${names.pascalCase} entity configuration.
 * Auto-generates mapper, serialiser, constraints, and indexes.
 */
export const ${names.pascalCase}Descriptor = defineEntity<${names.pascalCase}>()({
  ...${names.camelCase}Meta,
${!data.isCompanyScoped ? "\n  isCompanyScoped: false,\n" : ""}
  fields: {
${fieldDefinitions}
  },

  relationships: {
${relationshipDefinitions}
  },
});

export type ${names.pascalCase}DescriptorType = typeof ${names.pascalCase}Descriptor;
`;
}
