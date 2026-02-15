import { TemplateData, DescriptorRelationship } from "../types/template-data.interface";
import { isFoundationImport, FOUNDATION_PACKAGE, resolveNewDtoImportPath, resolveDtoImportPath } from "../transformers/import-resolver";
import { getValidationImports, getValidationDecorators, CypherType } from "../utils/type-utils";
import { toPascalCase } from "../transformers/name-transformer";

/**
 * Get the import path for a relationship's DTO
 */
function getDtoImportPath(rel: DescriptorRelationship, fromDir: string, fromModule: string): string {
  if (rel.isNewStructure) {
    // NEW structure: use absolute path from src
    return resolveNewDtoImportPath({
      directory: rel.relatedEntity.directory,
      moduleName: rel.relatedEntity.kebabCase,
    });
  } else {
    // OLD structure: foundation or relative path with proper resolution
    return isFoundationImport(rel.relatedEntity.directory)
      ? FOUNDATION_PACKAGE
      : resolveDtoImportPath({
          fromDir,
          fromModule,
          toDir: rel.relatedEntity.directory,
          toModule: rel.relatedEntity.kebabCase,
        });
  }
}

/**
 * Generate PUT DTO file content
 * Same as POST but excludes contextKey relationships (like Author)
 *
 * @param data - Template data
 * @returns Generated TypeScript code
 */
export function generatePutDTOFile(data: TemplateData): string {
  const { names, targetDir, fields, relationships, dtoFields } = data;

  // Build DTO imports for relationships (excluding contextKey)
  const dtoImportPaths = new Map<string, Set<string>>();

  for (const rel of relationships) {
    // Skip contextKey relationships (like Author) - same as POST
    if (rel.contextKey) continue;
    // Skip immutable relationships - they are set only on creation
    if (rel.immutable) continue;

    const hasFields = rel.fields && rel.fields.length > 0;

    // For MANY relationships with fields, ItemDTO is used (no external DTO import needed)
    if (rel.cardinality === "many" && hasFields) {
      continue;
    }

    const importPath = getDtoImportPath(rel, targetDir, names.kebabCase);

    if (!dtoImportPaths.has(importPath)) {
      dtoImportPaths.set(importPath, new Set());
    }

    // Import DataDTO for ONE relationships, DataListDTO for MANY relationships (without fields)
    if (rel.cardinality === "one") {
      dtoImportPaths.get(importPath)!.add(`${rel.relatedEntity.name}DataDTO`);
    } else {
      dtoImportPaths.get(importPath)!.add(`${rel.relatedEntity.name}DataListDTO`);
    }
  }

  const dtoImportsCode =
    dtoImportPaths.size > 0
      ? `\n${Array.from(dtoImportPaths.entries())
          .map(([path, items]) => `import { ${Array.from(items).join(", ")} } from "${path}";`)
          .join("\n")}\n`
      : "";

  // Build attribute validation using ONLY regular fields (not relationship property fields)
  const attributeFields = dtoFields
    .map((field) => {
      const optional = field.isOptional ? "?" : "";
      return `  ${field.decorators.join("\n  ")}\n  ${field.name}${optional}: ${field.type};`;
    })
    .join("\n\n");

  // Get dynamic validator imports based on field types
  // Include relationship property field types for generating meta DTOs (both ONE and MANY)
  const relPropertyTypes: CypherType[] = [];
  let hasItemDTOs = false; // Track if we need IsString for ItemDTO type field
  for (const rel of relationships) {
    if (rel.fields && rel.fields.length > 0 && !rel.contextKey && !rel.immutable) {
      for (const field of rel.fields) {
        relPropertyTypes.push(field.type as CypherType);
      }
      if (rel.cardinality === "many") {
        hasItemDTOs = true;
      }
    }
  }
  const fieldTypes = [...fields.map((f) => f.type as CypherType), ...relPropertyTypes];
  const validatorImports = getValidationImports(fieldTypes);
  // Add IsString and IsArray if we have ItemDTOs (for MANY relationships with fields)
  if (hasItemDTOs) {
    if (!validatorImports.includes("IsString")) {
      validatorImports.push("IsString");
    }
    if (!validatorImports.includes("IsArray")) {
      validatorImports.push("IsArray");
    }
  }

  // Generate meta DTOs for relationships with fields
  const metaDtoClasses: string[] = [];
  for (const rel of relationships) {
    if (rel.fields && rel.fields.length > 0 && !rel.contextKey && !rel.immutable) {
      const dtoKey = rel.dtoKey || rel.key;
      const metaDtoName = `${names.pascalCase}${toPascalCase(dtoKey)}MetaDTO`;

      // Generate meta DTO with relationship property fields
      const metaFields = rel.fields
        .map((field) => {
          const fieldType = field.type as CypherType;
          const decorators = getValidationDecorators(fieldType, field.required);
          const optional = !field.required ? "?" : "";
          return `  ${decorators.join("\n  ")}\n  ${field.name}${optional}: ${field.tsType};`;
        })
        .join("\n\n");

      if (rel.cardinality === "one") {
        // SINGLE relationship: wrapper DTO with data and meta
        const wrapperDtoName = `${names.pascalCase}${toPascalCase(dtoKey)}RelationshipDTO`;

        metaDtoClasses.push(`
export class ${metaDtoName} {
${metaFields}
}

export class ${wrapperDtoName} {
  @ValidateNested()
  @IsDefined()
  @Type(() => ${rel.relatedEntity.name}DataDTO)
  data: ${rel.relatedEntity.name}DataDTO;

  @ValidateNested()
  @IsOptional()
  @Type(() => ${metaDtoName})
  meta?: ${metaDtoName};
}`);
      } else {
        // MANY relationship: item DTO with per-item meta
        const itemDtoName = `${names.pascalCase}${toPascalCase(dtoKey)}ItemDTO`;

        metaDtoClasses.push(`
export class ${metaDtoName} {
${metaFields}
}

export class ${itemDtoName} {
  @IsUUID()
  id: string;

  @IsString()
  type: string;

  @ValidateNested()
  @IsOptional()
  @Type(() => ${metaDtoName})
  meta?: ${metaDtoName};
}`);
      }
    }
  }

  // Build relationship validation (exclude contextKey - same as POST)
  const relationshipFields = relationships
    .filter((rel) => !rel.contextKey && !rel.immutable) // Exclude contextKey and immutable relationships
    .map((rel) => {
      const decorators = [];
      const dtoKey = rel.dtoKey || rel.key;
      const hasFields = rel.fields && rel.fields.length > 0;

      if (hasFields && rel.cardinality === "one") {
        // SINGLE relationship with fields: use wrapper DTO with meta support
        const wrapperDtoName = `${names.pascalCase}${toPascalCase(dtoKey)}RelationshipDTO`;
        decorators.push("@ValidateNested()");

        if (!rel.required) {
          decorators.push("@IsOptional()");
        } else {
          decorators.push("@IsDefined()");
        }

        decorators.push(`@Type(() => ${wrapperDtoName})`);

        const optional = !rel.required ? "?" : "";
        return `  ${decorators.join("\n  ")}\n  ${dtoKey}${optional}: ${wrapperDtoName};`;
      } else if (hasFields && rel.cardinality === "many") {
        // MANY relationship with fields: use ItemDTO array with per-item meta
        const itemDtoName = `${names.pascalCase}${toPascalCase(dtoKey)}ItemDTO`;
        decorators.push("@ValidateNested({ each: true })");
        decorators.push("@IsArray()");

        if (!rel.required) {
          decorators.push("@IsOptional()");
        } else {
          decorators.push("@IsDefined()");
        }

        decorators.push(`@Type(() => ${itemDtoName})`);

        const optional = !rel.required ? "?" : "";
        return `  ${decorators.join("\n  ")}\n  ${dtoKey}${optional}: ${itemDtoName}[];`;
      } else {
        // Regular relationship without fields
        const dtoClass =
          rel.cardinality === "many" ? `${rel.relatedEntity.name}DataListDTO` : `${rel.relatedEntity.name}DataDTO`;

        if (rel.cardinality === "many") {
          decorators.push("@ValidateNested({ each: true })");
        } else {
          decorators.push("@ValidateNested()");
        }

        if (!rel.required) {
          decorators.push("@IsOptional()");
        } else {
          decorators.push("@IsDefined()");
        }

        decorators.push(`@Type(() => ${dtoClass})`);

        const optional = !rel.required ? "?" : "";
        return `  ${decorators.join("\n  ")}\n  ${dtoKey}${optional}: ${dtoClass};`;
      }
    })
    .join("\n\n");

  return `import { Type } from "class-transformer";
import { ${validatorImports.join(", ")} } from "class-validator";${dtoImportsCode}
import { ${names.camelCase}Meta } from "src/${targetDir}/${names.kebabCase}/entities/${names.kebabCase}.meta";
${metaDtoClasses.join("\n")}

export class ${names.pascalCase}PutAttributesDTO {
${attributeFields}
}

export class ${names.pascalCase}PutRelationshipsDTO {
${relationshipFields || "  // No relationships (excluding contextKey relationships)"}
}

export class ${names.pascalCase}PutDataDTO {
  @Equals(${names.camelCase}Meta.endpoint)
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
