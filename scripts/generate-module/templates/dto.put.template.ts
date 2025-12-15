import { TemplateData } from "../types/template-data.interface";

/**
 * Generate PUT DTO file content
 * Same as POST but excludes contextKey relationships (like Author)
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generatePutDTOFile(data: TemplateData): string {
  const { names, targetDir, fields, relationships } = data;

  // Build DTO imports for relationships (excluding contextKey)
  const dtoImportPaths = new Map<string, Set<string>>();

  for (const rel of relationships) {
    // Skip contextKey relationships (like Author) - same as POST
    if (rel.contextKey) continue;

    const importPath = `../../${rel.relatedEntity.directory}/${rel.relatedEntity.kebabCase}/dtos/${rel.relatedEntity.kebabCase}.dto`;

    if (!dtoImportPaths.has(importPath)) {
      dtoImportPaths.set(importPath, new Set());
    }

    // Add both singular and list DTOs
    dtoImportPaths.get(importPath)!.add(`${rel.relatedEntity.name}DataDTO`);
    if (rel.cardinality === "many") {
      dtoImportPaths.get(importPath)!.add(`${rel.relatedEntity.name}DataListDTO`);
    }
  }

  const dtoImportsCode =
    dtoImportPaths.size > 0
      ? `\n${Array.from(dtoImportPaths.entries())
          .map(([path, items]) => `import { ${Array.from(items).join(", ")} } from "${path}";`)
          .join("\n")}\n`
      : "";

  // Build attribute validation (same as POST)
  const attributeFields = fields
    .map((field) => {
      const decorators = [];
      decorators.push("@IsDefined()");
      decorators.push("@IsNotEmpty()");
      decorators.push(`@IsString()`); // Simplified - all fields are strings in current schema

      const optional = !field.required ? "?" : "";
      return `  ${decorators.join("\n  ")}\n  ${field.name}${optional}: ${field.tsType};`;
    })
    .join("\n\n");

  // Build relationship validation (exclude contextKey - same as POST)
  const relationshipFields = relationships
    .filter((rel) => !rel.contextKey) // Exclude Author and other contextKey relationships
    .map((rel) => {
      const decorators = [];
      const dtoClass =
        rel.cardinality === "many" ? `${rel.relatedEntity.name}DataListDTO` : `${rel.relatedEntity.name}DataDTO`;

      if (rel.cardinality === "many") {
        decorators.push("@ValidateNested({ each: true })");
      } else {
        decorators.push("@ValidateNested()");
      }

      if (rel.nullable) {
        decorators.push("@IsOptional()");
      } else {
        decorators.push("@IsDefined()");
      }

      decorators.push(`@Type(() => ${dtoClass})`);

      const optional = rel.nullable ? "?" : "";
      const dtoKey = rel.dtoKey || rel.key;
      return `  ${decorators.join("\n  ")}\n  ${dtoKey}${optional}: ${dtoClass};`;
    })
    .join("\n\n");

  return `import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";${dtoImportsCode}
import { ${names.pascalCase}Descriptor } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}";

export class ${names.pascalCase}PutAttributesDTO {
${attributeFields}
}

export class ${names.pascalCase}PutRelationshipsDTO {
${relationshipFields || "  // No relationships (excluding contextKey relationships)"}
}

export class ${names.pascalCase}PutDataDTO {
  @Equals(${names.pascalCase}Descriptor.model.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => ${names.pascalCase}PutAttributesDTO)
  attributes: ${names.pascalCase}PutAttributesDTO;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => ${names.pascalCase}PutRelationshipsDTO)
  relationships: ${names.pascalCase}PutRelationshipsDTO;
}

export class ${names.pascalCase}PutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => ${names.pascalCase}PutDataDTO)
  data: ${names.pascalCase}PutDataDTO;
}
`;
}
