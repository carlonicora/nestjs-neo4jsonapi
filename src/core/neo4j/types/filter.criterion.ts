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

/**
 * A caller-built, parameterised WHERE condition on the entity node, AND-ed with `filters`.
 *
 * `clause` is caller-written code and must never contain request input: every value goes in `params`.
 */
export interface ExtraWhereCondition {
  /** Caller-written Cypher boolean expression, never request input; may reference only the entity node alias and the `$params` below. */
  clause: string;
  /** Merged into the query parameters. */
  params: Record<string, unknown>;
}

export interface SortCriterion {
  field: string;
  direction: "asc" | "desc";
}
