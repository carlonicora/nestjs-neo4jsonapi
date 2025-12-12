import { TemplateData } from "../types/template-data.interface";

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
  const { names, endpoint, nodeName, labelName, fields, relationships, entityImports, metaImports } = data;

  // Build imports
  const libraryImports = ["defineEntity", "Entity"];
  if (data.isCompanyScoped) {
    libraryImports.push("Company");
  }

  // Add entity imports for relationships
  const uniqueEntityImports = new Set<string>();
  const entityImportsByPath = new Map<string, string[]>();

  for (const rel of relationships) {
    if (!uniqueEntityImports.has(rel.relatedEntity.name)) {
      uniqueEntityImports.add(rel.relatedEntity.name);

      // Group by import path
      const importPath = `../../${rel.relatedEntity.directory}/${rel.relatedEntity.kebabCase}/entities/${rel.relatedEntity.kebabCase}.entity`;
      if (!entityImportsByPath.has(importPath)) {
        entityImportsByPath.set(importPath, []);
      }
      entityImportsByPath.get(importPath)!.push(rel.relatedEntity.name);
    }
  }

  // Add meta imports for relationships
  const uniqueMetaImports = new Set<string>();
  const metaImportsByPath = new Map<string, string[]>();

  for (const rel of relationships) {
    if (!uniqueMetaImports.has(rel.model)) {
      uniqueMetaImports.add(rel.model);

      // Group by import path
      const importPath = `../../${rel.relatedEntity.directory}/${rel.relatedEntity.kebabCase}/entities/${rel.relatedEntity.kebabCase}.meta`;
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

      if (rel.contextKey) {
        parts.push(`contextKey: "${rel.contextKey}"`);
      }
      if (rel.dtoKey) {
        parts.push(`dtoKey: "${rel.dtoKey}"`);
      }

      return `    ${rel.key}: {\n      ${parts.join(",\n      ")},\n    },`;
    })
    .join("\n");

  return `import { ${libraryImports.join(", ")} } from "@carlonicora/nestjs-neo4jsonapi";
${Array.from(entityImportsByPath.entries())
  .map(([path, items]) => `import { ${items.join(", ")} } from "${path}";`)
  .join("\n")}
${Array.from(metaImportsByPath.entries())
  .map(([path, items]) => `import { ${items.join(", ")} } from "${path}";`)
  .join("\n")}

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
    const optional = rel.nullable ? "?" : "";
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
  type: "${endpoint}",
  endpoint: "${endpoint}",
  nodeName: "${nodeName}",
  labelName: "${labelName}",
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
