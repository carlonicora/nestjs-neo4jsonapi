/**
 * Supported filter operators for structured queries against AbstractRepository.
 *
 * Compatibility rules (enforced by build-filter-clauses):
 * - eq, ne, in            → any scalar type
 * - like                  → string only
 * - gt, gte, lt, lte      → number, date, datetime
 * - isNull, isNotNull     → any type (value not used)
 */
export type FilterOperator = "eq" | "ne" | "in" | "like" | "gt" | "gte" | "lt" | "lte" | "isNull" | "isNotNull";

export interface FilterCriterion {
  field: string;
  op: FilterOperator;
  value?: string | number | boolean | string[] | number[];
}

export interface SortCriterion {
  field: string;
  direction: "asc" | "desc";
}
