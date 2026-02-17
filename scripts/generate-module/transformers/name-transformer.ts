import { NameTransforms } from "../types/template-data.interface";

/**
 * Transform a module name to all necessary case conventions
 *
 * @param moduleName - PascalCase module name (e.g., "Comment")
 * @param endpoint - kebab-case plural endpoint (e.g., "comments")
 * @returns All name transformations
 */
export function transformNames(moduleName: string, endpoint: string): NameTransforms {
  return {
    pascalCase: moduleName,
    camelCase: toCamelCase(moduleName),
    kebabCase: toKebabCase(moduleName),
    pluralKebab: endpoint,
  };
}

/**
 * Convert PascalCase to camelCase
 *
 * @param str - PascalCase string
 * @returns camelCase string
 */
export function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Convert PascalCase to kebab-case
 *
 * @param str - PascalCase string
 * @returns kebab-case string
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
}

/**
 * Convert string to PascalCase
 *
 * @param str - Any case string
 * @returns PascalCase string
 */
export function toPascalCase(str: string): string {
  return str
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

/**
 * Simple pluralization
 * Note: This is a basic implementation. For production, consider using a library like 'pluralize'
 *
 * @param str - Singular form
 * @returns Plural form
 */
export function pluralize(str: string): string {
  if (str.endsWith("s")) {
    return str + "es";
  }
  if (str.endsWith("y") && !["a", "e", "i", "o", "u"].includes(str[str.length - 2])) {
    return str.slice(0, -1) + "ies";
  }
  return str + "s";
}
