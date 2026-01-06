import { FieldDef } from "../../common/interfaces/entity.schema.interface";

/**
 * Generates example values for OpenAPI documentation based on field name and type.
 * Uses intelligent defaults based on common naming patterns.
 */
export function generateExampleValue(fieldName: string, fieldDef: FieldDef): unknown {
  // If field has a default value, use it
  if (fieldDef.default !== undefined) {
    return fieldDef.default;
  }

  // Handle array types
  if (fieldDef.type.endsWith("[]")) {
    const baseExample = generateScalarExample(fieldName, fieldDef.type.slice(0, -2) as any);
    return [baseExample];
  }

  return generateScalarExample(fieldName, fieldDef.type);
}

/**
 * Generates a scalar example value based on field name patterns and type.
 */
function generateScalarExample(fieldName: string, type: string): unknown {
  const lowerName = fieldName.toLowerCase();

  // Check for common naming patterns first
  if (lowerName === "id" || lowerName.endsWith("id")) {
    return "abc123-def456-ghi789";
  }

  if (lowerName.includes("url") || lowerName.includes("uri") || lowerName.includes("link")) {
    return "https://example.com/resource/123";
  }

  if (lowerName.includes("email")) {
    return "user@example.com";
  }

  if (lowerName === "name" || lowerName.endsWith("name")) {
    return "Example Name";
  }

  if (lowerName.includes("title")) {
    return "Example Title";
  }

  if (lowerName.includes("description") || lowerName.includes("content") || lowerName.includes("text")) {
    return "This is an example description or content text.";
  }

  if (lowerName.includes("phone") || lowerName.includes("tel")) {
    return "+1-555-123-4567";
  }

  if (lowerName.includes("address")) {
    return "123 Example Street, City, Country";
  }

  // Check rate/percentage before count (discountRate contains 'count')
  if (lowerName.includes("percentage") || lowerName.includes("percent") || lowerName.includes("rate")) {
    return 75.5;
  }

  if (lowerName.includes("count") || lowerName.includes("total") || lowerName.includes("quantity")) {
    return 10;
  }

  if (lowerName.includes("price") || lowerName.includes("amount") || lowerName.includes("cost")) {
    return 99.99;
  }

  if (lowerName.includes("enabled") || lowerName.includes("active") || lowerName.includes("visible")) {
    return true;
  }

  if (lowerName.includes("disabled") || lowerName.includes("hidden") || lowerName.includes("deleted")) {
    return false;
  }

  // Fall back to type-based examples
  switch (type) {
    case "string":
      return "example value";
    case "number":
      return 42;
    case "boolean":
      return true;
    case "date":
      return "2024-01-15";
    case "datetime":
      return "2024-01-15T10:30:00Z";
    case "json":
      return { key: "value" };
    default:
      return "example";
  }
}

/**
 * Generates a complete example attributes object for an entity.
 */
export function generateExampleAttributes(fields: Record<string, FieldDef>): Record<string, unknown> {
  const example: Record<string, unknown> = {};

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    example[fieldName] = generateExampleValue(fieldName, fieldDef);
  }

  return example;
}
