import { JsonModuleDefinition } from "../types/json-schema.interface";
import { normalizeCypherType, getValidTypes } from "../utils/type-utils";

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Validate JSON module definition
 *
 * @param schema - JSON module definition
 * @returns Array of validation errors (empty if valid)
 */
export function validateJsonSchema(schema: any): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required fields
  const required = ["moduleName", "endpointName", "targetDir"];
  for (const field of required) {
    if (!schema[field]) {
      errors.push({
        field,
        message: `${field} is required`,
        severity: "error",
      });
    }
  }

  // Module name format (PascalCase)
  if (schema.moduleName && !/^[A-Z][a-zA-Z0-9]*$/.test(schema.moduleName)) {
    errors.push({
      field: "moduleName",
      message: 'Must be PascalCase (e.g., "Comment", "Discussion")',
      severity: "error",
    });
  }

  // Endpoint format (kebab-case plural)
  if (schema.endpointName && !/^[a-z][a-z0-9-]*$/.test(schema.endpointName)) {
    errors.push({
      field: "endpointName",
      message: 'Must be kebab-case (e.g., "comments", "discussions")',
      severity: "error",
    });
  }

  // Target directory validation - must start with "features" or "foundations"
  if (schema.targetDir) {
    const baseDir = schema.targetDir.split("/")[0];
    if (!["features", "foundations"].includes(baseDir)) {
      errors.push({
        field: "targetDir",
        message: 'Must start with "features" or "foundations"',
        severity: "error",
      });
    }
  }

  // Fields validation
  if (schema.fields && Array.isArray(schema.fields)) {
    schema.fields.forEach((field: any, index: number) => {
      if (!field.name) {
        errors.push({
          field: `fields[${index}].name`,
          message: "Field name is required",
          severity: "error",
        });
      }

      if (!field.type) {
        errors.push({
          field: `fields[${index}].type`,
          message: "Field type is required",
          severity: "error",
        });
      } else if (!normalizeCypherType(field.type)) {
        const validTypes = getValidTypes();
        errors.push({
          field: `fields[${index}].type`,
          message: `Invalid type "${field.type}". Valid types: ${validTypes.join(", ")}`,
          severity: "error",
        });
      }

      if (field.nullable === undefined) {
        errors.push({
          field: `fields[${index}].nullable`,
          message: "Field nullable flag is required",
          severity: "error",
        });
      }
    });
  }

  // Relationships validation
  if (schema.relationships && Array.isArray(schema.relationships)) {
    schema.relationships.forEach((rel: any, index: number) => {
      if (!rel.name) {
        errors.push({
          field: `relationships[${index}].name`,
          message: "Relationship name is required",
          severity: "error",
        });
      }

      if (!rel.directory) {
        errors.push({
          field: `relationships[${index}].directory`,
          message: "Relationship directory is required",
          severity: "error",
        });
      }

      if (rel.single === undefined) {
        errors.push({
          field: `relationships[${index}].single`,
          message: "Relationship single flag is required",
          severity: "error",
        });
      }

      if (!rel.relationshipName) {
        errors.push({
          field: `relationships[${index}].relationshipName`,
          message: "Neo4j relationship name is required",
          severity: "error",
        });
      }

      if (rel.relationshipName && !/^[A-Z_]+$/.test(rel.relationshipName)) {
        errors.push({
          field: `relationships[${index}].relationshipName`,
          message: 'Should be UPPER_SNAKE_CASE (e.g., "PUBLISHED", "COMMENT_TO")',
          severity: "warning",
        });
      }

      if (rel.toNode === undefined) {
        errors.push({
          field: `relationships[${index}].toNode`,
          message: "Relationship toNode flag is required",
          severity: "error",
        });
      }

      if (rel.nullable === undefined) {
        errors.push({
          field: `relationships[${index}].nullable`,
          message: "Relationship nullable flag is required",
          severity: "error",
        });
      }

      if (rel.immutable && rel.nullable) {
        errors.push({
          field: `relationships[${index}].immutable`,
          message: "Immutable relationships are typically required (set once at creation). Consider setting nullable to false.",
          severity: "warning",
        });
      }

      // Validate alias format if provided (must be PascalCase)
      if (rel.alias && !/^[A-Z][a-zA-Z0-9]*$/.test(rel.alias)) {
        errors.push({
          field: `relationships[${index}].alias`,
          message: 'Alias must be PascalCase (e.g., "DestinedPerson", "ReceivedByPerson")',
          severity: "error",
        });
      }
    });

    // Check for duplicate relationship targets without alias
    const nameCount = new Map<string, number[]>();
    schema.relationships.forEach((rel: any, index: number) => {
      const name = rel.name;
      if (!nameCount.has(name)) {
        nameCount.set(name, []);
      }
      nameCount.get(name)!.push(index);
    });

    for (const [name, indices] of nameCount.entries()) {
      if (indices.length > 1) {
        for (const idx of indices) {
          const rel = schema.relationships[idx];
          if (!rel.alias) {
            errors.push({
              field: `relationships[${idx}].alias`,
              message: `Relationship to "${name}" appears ${indices.length} times. All instances must have an "alias" field to avoid key collisions. Example: "alias": "DestinedPerson"`,
              severity: "error",
            });
          }
        }
      }
    }

    // Check for duplicate aliases
    const aliasSet = new Set<string>();
    schema.relationships.forEach((rel: any, index: number) => {
      if (rel.alias) {
        if (aliasSet.has(rel.alias)) {
          errors.push({
            field: `relationships[${index}].alias`,
            message: `Duplicate alias "${rel.alias}". Each alias must be unique.`,
            severity: "error",
          });
        }
        aliasSet.add(rel.alias);
      }
    });
  }

  return errors;
}

/**
 * Check if validation passed (no errors, only warnings allowed)
 *
 * @param errors - Validation errors
 * @returns true if validation passed
 */
export function validationPassed(errors: ValidationError[]): boolean {
  return errors.filter((e) => e.severity === "error").length === 0;
}

/**
 * Format validation errors for display
 *
 * @param errors - Validation errors
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return "No validation errors";
  }

  const errorLines = errors.map((error) => {
    const icon = error.severity === "error" ? "❌" : "⚠️";
    return `${icon} ${error.field}: ${error.message}`;
  });

  return errorLines.join("\n");
}
