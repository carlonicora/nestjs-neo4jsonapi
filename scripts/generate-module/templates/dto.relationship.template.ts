import { TemplateData, DescriptorRelationship } from "../types/template-data.interface";
import { getValidationImports, getValidationDecorators, CypherType } from "../utils/type-utils";
import { toPascalCase } from "../transformers/name-transformer";

/**
 * Generate relationship operation DTO file content
 *
 * This generates DTOs for add/remove operations on MANY relationships:
 * - {Entity}{Relationship}AddItemDTO - Item with id, type, and optional meta
 * - {Entity}{Relationship}AddDTO - Batch add with array of items
 * - {Entity}{Relationship}AddSingleDataDTO - Single add data with optional meta
 * - {Entity}{Relationship}AddSingleDTO - Single add wrapper
 * - {Entity}{Relationship}RemoveItemDTO - Item with id and type
 * - {Entity}{Relationship}RemoveDTO - Batch remove with array of items
 *
 * @param data - Template data
 * @returns Generated TypeScript code, or null if no MANY relationships exist
 */
export function generateRelationshipDTOFile(data: TemplateData): string | null {
  const { names, relationships } = data;

  // Filter to only MANY relationships that are not contextKey
  const manyRelationships = relationships.filter(
    (rel) => rel.cardinality === "many" && !rel.contextKey,
  );

  // If no MANY relationships, don't generate this file
  if (manyRelationships.length === 0) {
    return null;
  }

  // Collect all field types for imports
  const relPropertyTypes: CypherType[] = [];
  for (const rel of manyRelationships) {
    if (rel.fields && rel.fields.length > 0) {
      for (const field of rel.fields) {
        relPropertyTypes.push(field.type as CypherType);
      }
    }
  }

  // Build validator imports
  const validatorImports = getValidationImports(relPropertyTypes);
  // Always need these for relationship DTOs
  if (!validatorImports.includes("IsUUID")) validatorImports.push("IsUUID");
  if (!validatorImports.includes("IsString")) validatorImports.push("IsString");
  if (!validatorImports.includes("IsArray")) validatorImports.push("IsArray");
  if (!validatorImports.includes("ValidateNested")) validatorImports.push("ValidateNested");
  if (!validatorImports.includes("IsOptional")) validatorImports.push("IsOptional");
  if (!validatorImports.includes("IsDefined")) validatorImports.push("IsDefined");

  // Generate DTO classes for each MANY relationship
  const dtoClasses: string[] = [];

  for (const rel of manyRelationships) {
    const dtoKey = rel.dtoKey || rel.key;
    const pascalDtoKey = toPascalCase(dtoKey);
    const hasFields = rel.fields && rel.fields.length > 0;

    // Generate MetaDTO if relationship has fields
    if (hasFields) {
      const metaDtoName = `${names.pascalCase}${pascalDtoKey}MetaDTO`;
      const metaFields = rel.fields!
        .map((field) => {
          const fieldType = field.type as CypherType;
          const decorators = getValidationDecorators(fieldType, field.required);
          const optional = !field.required ? "?" : "";
          return `  ${decorators.join("\n  ")}\n  ${field.name}${optional}: ${field.tsType};`;
        })
        .join("\n\n");

      dtoClasses.push(`
/**
 * Edge property metadata for ${dtoKey} relationship
 */
export class ${metaDtoName} {
${metaFields}
}`);
    }

    // Generate AddItemDTO
    const addItemDtoName = `${names.pascalCase}${pascalDtoKey}AddItemDTO`;
    const metaType = hasFields
      ? `${names.pascalCase}${pascalDtoKey}MetaDTO`
      : null;

    dtoClasses.push(`
/**
 * Single item for batch add to ${dtoKey} relationship
 */
export class ${addItemDtoName} {
  @IsUUID()
  id: string;

  @IsString()
  type: string;
${
  metaType
    ? `
  @ValidateNested()
  @IsOptional()
  @Type(() => ${metaType})
  meta?: ${metaType};`
    : ""
}
}`);

    // Generate AddDTO (batch)
    const addDtoName = `${names.pascalCase}${pascalDtoKey}AddDTO`;
    dtoClasses.push(`
/**
 * Batch add items to ${dtoKey} relationship
 * POST /${names.kebabCase}/:id/${rel.relatedEntity.kebabCase}
 */
export class ${addDtoName} {
  @ValidateNested({ each: true })
  @IsArray()
  @IsDefined()
  @Type(() => ${addItemDtoName})
  data: ${addItemDtoName}[];
}`);

    // Generate AddSingleDataDTO (for single add endpoint, meta only)
    if (hasFields) {
      const addSingleDataDtoName = `${names.pascalCase}${pascalDtoKey}AddSingleDataDTO`;
      dtoClasses.push(`
/**
 * Data for single add to ${dtoKey} relationship (id from URL)
 */
export class ${addSingleDataDtoName} {
  @ValidateNested()
  @IsOptional()
  @Type(() => ${metaType})
  meta?: ${metaType};
}`);

      // Generate AddSingleDTO wrapper
      const addSingleDtoName = `${names.pascalCase}${pascalDtoKey}AddSingleDTO`;
      dtoClasses.push(`
/**
 * Single add to ${dtoKey} relationship with optional edge properties
 * POST /${names.kebabCase}/:id/${rel.relatedEntity.kebabCase}/:${rel.key}Id
 */
export class ${addSingleDtoName} {
  @ValidateNested()
  @IsOptional()
  @Type(() => ${addSingleDataDtoName})
  data?: ${addSingleDataDtoName};
}`);
    } else {
      // No fields - just an empty body wrapper
      const addSingleDtoName = `${names.pascalCase}${pascalDtoKey}AddSingleDTO`;
      dtoClasses.push(`
/**
 * Single add to ${dtoKey} relationship (no edge properties)
 * POST /${names.kebabCase}/:id/${rel.relatedEntity.kebabCase}/:${rel.key}Id
 */
export class ${addSingleDtoName} {
  // No body required - id comes from URL
}`);
    }

    // Generate RemoveItemDTO
    const removeItemDtoName = `${names.pascalCase}${pascalDtoKey}RemoveItemDTO`;
    dtoClasses.push(`
/**
 * Single item for batch remove from ${dtoKey} relationship
 */
export class ${removeItemDtoName} {
  @IsUUID()
  id: string;

  @IsString()
  type: string;
}`);

    // Generate RemoveDTO (batch)
    const removeDtoName = `${names.pascalCase}${pascalDtoKey}RemoveDTO`;
    dtoClasses.push(`
/**
 * Batch remove items from ${dtoKey} relationship
 * DELETE /${names.kebabCase}/:id/${rel.relatedEntity.kebabCase}
 */
export class ${removeDtoName} {
  @ValidateNested({ each: true })
  @IsArray()
  @IsDefined()
  @Type(() => ${removeItemDtoName})
  data: ${removeItemDtoName}[];
}`);
  }

  return `import { Type } from "class-transformer";
import { ${validatorImports.sort().join(", ")} } from "class-validator";
${dtoClasses.join("\n")}
`;
}

/**
 * Get the list of MANY relationships for generating relationship endpoints
 */
export function getManyRelationships(relationships: DescriptorRelationship[]): DescriptorRelationship[] {
  return relationships.filter((rel) => rel.cardinality === "many" && !rel.contextKey);
}
