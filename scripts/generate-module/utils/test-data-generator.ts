/**
 * Test Data Generator Utilities
 *
 * Helper functions for generating test data, mock entities, and test IDs
 * for auto-generated test files.
 */

import { TemplateField, DescriptorRelationship } from "../types/template-data.interface";
import { CypherType, isArrayType, getBaseType } from "./type-utils";

/**
 * Generate a deterministic UUID-like string based on entity name and index
 */
export function generateTestUUID(entityName: string, index: number): string {
  // Create a predictable but unique-looking UUID
  const base = entityName.toLowerCase().padEnd(8, "0").slice(0, 8);
  const suffix = index.toString().padStart(4, "0");
  return `${base}-${suffix}-4000-a000-000000000${suffix}`;
}

/**
 * Generate TEST_IDS constant code for a given entity
 */
export function generateTestIdsCode(entityName: string, relationships: DescriptorRelationship[]): string {
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);

  const ids: string[] = [`${camelCase}Id: "${generateTestUUID(entityName, 1)}"`];

  // Add company and user IDs (always needed)
  ids.push(`companyId: "${generateTestUUID("company", 1)}"`);
  ids.push(`userId: "${generateTestUUID("user", 1)}"`);

  // Add IDs for each relationship
  for (const rel of relationships) {
    const relIdName = `${rel.key}Id`;
    if (!ids.some((id) => id.startsWith(relIdName))) {
      ids.push(`${relIdName}: "${generateTestUUID(rel.relatedEntity.name, 1)}"`);
    }
  }

  return `const TEST_IDS = {
    ${ids.join(",\n    ")},
  };`;
}

/**
 * Get a mock value for a given Cypher type and field name
 */
export function getMockValue(type: CypherType, fieldName: string): string {
  if (isArrayType(type)) {
    const baseType = getBaseType(type);
    switch (baseType) {
      case "string":
        return `["test-${fieldName}-1", "test-${fieldName}-2"]`;
      case "number":
        return "[1, 2, 3]";
      case "boolean":
        return "[true, false]";
      case "date":
      case "datetime":
        return '["2024-01-01", "2024-01-02"]';
      case "json":
        return "[{}, {}]";
      default:
        return "[]";
    }
  }

  switch (type) {
    case "string":
      return `"test-${fieldName}"`;
    case "number":
      return "100";
    case "boolean":
      return "true";
    case "date":
      return '"2024-01-01"';
    case "datetime":
      return '"2024-01-01T00:00:00.000Z"';
    case "json":
      return "{}";
    default:
      return "null";
  }
}

/**
 * Generate MOCK_ENTITY constant code for a given entity
 */
export function generateMockEntityCode(entityName: string, fields: TemplateField[]): string {
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);

  const fieldValues: string[] = [`id: TEST_IDS.${camelCase}Id`];

  for (const field of fields) {
    const mockValue = getMockValue(field.type as CypherType, field.name);
    fieldValues.push(`${field.name}: ${mockValue}`);
  }

  // Add common timestamp fields
  fieldValues.push('createdAt: "2024-01-01T00:00:00.000Z"');
  fieldValues.push('updatedAt: "2024-01-01T00:00:00.000Z"');

  return `const MOCK_${entityName.toUpperCase()} = {
    ${fieldValues.join(",\n    ")},
  };`;
}

/**
 * Generate mock JSON:API response for a single entity
 */
export function generateMockJsonApiResponse(entityName: string, endpoint: string): string {
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);

  return `const MOCK_JSONAPI_RESPONSE = {
    data: {
      type: "${endpoint}",
      id: TEST_IDS.${camelCase}Id,
      attributes: MOCK_${entityName.toUpperCase()},
    },
  };`;
}

/**
 * Generate mock JSON:API list response
 */
export function generateMockJsonApiListResponse(entityName: string, endpoint: string): string {
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);

  return `const MOCK_JSONAPI_LIST_RESPONSE = {
    data: [
      {
        type: "${endpoint}",
        id: TEST_IDS.${camelCase}Id,
        attributes: MOCK_${entityName.toUpperCase()},
      },
    ],
    meta: {
      total: 1,
    },
  };`;
}

/**
 * Get MANY relationships (for relationship endpoint tests)
 */
export function getMANYRelationships(relationships: DescriptorRelationship[]): DescriptorRelationship[] {
  return relationships.filter((rel) => rel.cardinality === "many" && !rel.contextKey);
}

/**
 * Check if there are any MANY relationships
 */
export function hasMANYRelationships(relationships: DescriptorRelationship[]): boolean {
  return getMANYRelationships(relationships).length > 0;
}

/**
 * Generate mock DTO data for POST request
 */
export function generateMockPostDTOCode(entityName: string, fields: TemplateField[], endpoint: string): string {
  const requiredFields = fields.filter((f) => f.required);

  const attributeValues: string[] = [];
  for (const field of requiredFields) {
    const mockValue = getMockValue(field.type as CypherType, field.name);
    attributeValues.push(`${field.name}: ${mockValue}`);
  }

  // Handle empty attributes case (no required fields)
  const attributesContent =
    attributeValues.length > 0 ? `\n        ${attributeValues.join(",\n        ")},\n      ` : "";

  return `const MOCK_POST_DTO = {
    data: {
      type: "${endpoint}",
      attributes: {${attributesContent}},
    },
  };`;
}

/**
 * Generate mock DTO data for PUT request
 */
export function generateMockPutDTOCode(entityName: string, fields: TemplateField[], endpoint: string): string {
  const camelCase = entityName.charAt(0).toLowerCase() + entityName.slice(1);

  const attributeValues: string[] = [];
  for (const field of fields) {
    const mockValue = getMockValue(field.type as CypherType, field.name);
    attributeValues.push(`${field.name}: ${mockValue}`);
  }

  // Handle empty attributes case (no fields)
  const attributesContent =
    attributeValues.length > 0 ? `\n        ${attributeValues.join(",\n        ")},\n      ` : "";

  return `const MOCK_PUT_DTO = {
    data: {
      type: "${endpoint}",
      id: TEST_IDS.${camelCase}Id,
      attributes: {${attributesContent}},
    },
  };`;
}

/**
 * Convert PascalCase to camelCase
 */
export function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Convert camelCase to PascalCase
 */
export function toPascalCase(str: string): string {
  return str
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}
