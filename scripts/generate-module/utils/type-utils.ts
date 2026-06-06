/**
 * Type utilities for the generate-module command
 * Handles type normalization, TypeScript mapping, and validation decorator generation
 */

// Valid base types (scalar)
const VALID_BASE_TYPES = ["string", "number", "boolean", "date", "datetime", "json"] as const;

// Valid array types
const VALID_ARRAY_TYPES = ["string[]", "number[]", "boolean[]", "date[]", "datetime[]", "json[]"] as const;

export type CypherBaseType = (typeof VALID_BASE_TYPES)[number];
export type CypherArrayType = (typeof VALID_ARRAY_TYPES)[number];
export type CypherType = CypherBaseType | CypherArrayType;

/**
 * Normalize a type string to canonical lowercase form
 * Handles case-insensitive input (e.g., "String", "NUMBER[]", "DateTime")
 *
 * The pseudo-type "blocknote" is a frontend-facing rich-text marker: on the
 * backend it is persisted as a stringified-JSON `string` (Neo4j cannot store
 * nested objects as a property), so it normalises to "string". The frontend
 * generator reads the raw "blocknote" type to wire a BlockNote editor.
 *
 * @param input - The input type string (case-insensitive)
 * @returns The normalized CypherType or null if invalid
 */
export function normalizeCypherType(input: string): CypherType | null {
  const normalized = input.toLowerCase().trim();

  // Rich-text BlockNote fields are stored as stringified JSON on the backend.
  if (normalized === "blocknote") {
    return "string";
  }

  if ((VALID_BASE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as CypherBaseType;
  }

  if ((VALID_ARRAY_TYPES as readonly string[]).includes(normalized)) {
    return normalized as CypherArrayType;
  }

  return null;
}

/**
 * Check if a type is an array type
 *
 * @param type - The CypherType to check
 * @returns true if the type ends with []
 */
export function isArrayType(type: CypherType): type is CypherArrayType {
  return type.endsWith("[]");
}

/**
 * Get the base type from an array type
 *
 * @param type - The CypherType (may be array or scalar)
 * @returns The base type (e.g., "number[]" -> "number")
 */
export function getBaseType(type: CypherType): CypherBaseType {
  if (isArrayType(type)) {
    return type.slice(0, -2) as CypherBaseType;
  }
  return type as CypherBaseType;
}

/**
 * Get the TypeScript type string for a CypherType
 *
 * @param type - The CypherType
 * @returns The TypeScript type string
 */
export function getTsType(type: CypherType): string {
  const typeMap: Record<CypherType, string> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    date: "string",
    datetime: "string",
    json: "any",
    "string[]": "string[]",
    "number[]": "number[]",
    "boolean[]": "boolean[]",
    "date[]": "string[]",
    "datetime[]": "string[]",
    "json[]": "any[]",
  };
  return typeMap[type];
}

/**
 * Get validation decorators for a field type
 *
 * @param type - The CypherType
 * @param required - Whether the field is required
 * @returns Array of decorator strings
 */
export function getValidationDecorators(type: CypherType, required: boolean): string[] {
  const decorators: string[] = [];

  // Required/optional handling
  if (required) {
    decorators.push("@IsDefined()");
    // Only add @IsNotEmpty() for non-array scalar types
    if (!isArrayType(type) && type !== "boolean") {
      decorators.push("@IsNotEmpty()");
    }
  } else {
    decorators.push("@IsOptional()");
  }

  // Type-specific validators
  if (isArrayType(type)) {
    decorators.push("@IsArray()");
    const baseType = getBaseType(type);
    switch (baseType) {
      case "string":
        decorators.push("@IsString({ each: true })");
        break;
      case "number":
        decorators.push("@IsNumber({}, { each: true })");
        break;
      case "boolean":
        decorators.push("@IsBoolean({ each: true })");
        break;
      case "date":
      case "datetime":
        decorators.push("@IsDateString({}, { each: true })");
        break;
      case "json":
        // No element validation for json[] - just validate it's an array
        break;
    }
  } else {
    switch (type) {
      case "string":
        decorators.push("@IsString()");
        break;
      case "number":
        decorators.push("@IsNumber()");
        break;
      case "boolean":
        decorators.push("@IsBoolean()");
        break;
      case "date":
      case "datetime":
        decorators.push("@IsDateString()");
        break;
      case "json":
        decorators.push("@IsObject()");
        break;
    }
  }

  return decorators;
}

/**
 * Get required class-validator imports for a set of types
 *
 * @param types - Array of CypherTypes used in the entity
 * @returns Array of import names needed from class-validator
 */
export function getValidationImports(types: CypherType[]): string[] {
  // Always needed imports
  const imports = new Set<string>(["Equals", "IsUUID", "ValidateNested", "IsNotEmpty", "IsDefined", "IsOptional"]);

  for (const type of types) {
    if (isArrayType(type)) {
      imports.add("IsArray");

      const baseType = getBaseType(type);
      switch (baseType) {
        case "string":
          imports.add("IsString");
          break;
        case "number":
          imports.add("IsNumber");
          break;
        case "boolean":
          imports.add("IsBoolean");
          break;
        case "date":
        case "datetime":
          imports.add("IsDateString");
          break;
        // json[] doesn't need additional imports
      }
    } else {
      switch (type) {
        case "string":
          imports.add("IsString");
          break;
        case "number":
          imports.add("IsNumber");
          break;
        case "boolean":
          imports.add("IsBoolean");
          break;
        case "date":
        case "datetime":
          imports.add("IsDateString");
          break;
        case "json":
          imports.add("IsObject");
          break;
      }
    }
  }

  return Array.from(imports).sort();
}

/**
 * Get all valid type strings for validation messages
 *
 * @returns Array of all valid type strings
 */
export function getValidTypes(): string[] {
  return [...VALID_BASE_TYPES, ...VALID_ARRAY_TYPES, "blocknote"];
}
