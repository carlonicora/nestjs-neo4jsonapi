import type { CatalogField } from "../interfaces/graph.catalog.interface";
import type {
  ExternalEntitySource,
  ExternalFilterCapability,
} from "../../../common/interfaces/external.entity.source.interface";

// Lives apart from traverse.tool so describe_entity's description builder can
// use it and traverse.tool can import that builder without an import cycle.
// traverse.tool re-exports everything here.

/** Operators valid for each catalog field type. A type missing here accepts no operator. */
export const TYPE_TO_OP_ALLOWED: Record<string, Set<string>> = {
  string: new Set(["eq", "ne", "in", "like", "isNull", "isNotNull"]),
  number: new Set(["eq", "ne", "in", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  boolean: new Set(["eq", "ne", "isNull", "isNotNull"]),
  date: new Set(["eq", "ne", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
  datetime: new Set(["eq", "ne", "gt", "gte", "lt", "lte", "isNull", "isNotNull"]),
};

/**
 * The filter capabilities a type's service declares, or `undefined` when it
 * declares none (records in the app database: the type table applies).
 */
export function serviceFilterCapabilities(svc: unknown): ExternalFilterCapability[] | undefined {
  const hook = (svc as Partial<ExternalEntitySource> | undefined)?.filterCapabilities;
  return typeof hook === "function" ? hook.call(svc) : undefined;
}

/**
 * The operators a filter on `field` may use. When the service declares
 * capabilities they win over the type table: exactly the operators listed for
 * the field, none when it is not listed. Otherwise the operators of the field's type.
 */
export function allowedFilterOperators(
  field: CatalogField,
  capabilities: ExternalFilterCapability[] | undefined,
): string[] {
  if (capabilities) return [...(capabilities.find((c) => c.field === field.name)?.operators ?? [])];
  return Array.from(TYPE_TO_OP_ALLOWED[field.type] ?? []);
}
