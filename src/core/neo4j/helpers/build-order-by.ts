import { SortCriterion } from "../types/filter.criterion";

const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function buildOrderByClause(input: { nodeAlias: string; sort: SortCriterion[] }): string {
  if (!VALID_IDENTIFIER.test(input.nodeAlias)) {
    throw new Error(`Invalid nodeAlias identifier: ${input.nodeAlias}`);
  }
  if (!input.sort.length) return "";
  const parts = input.sort.map((s) => {
    if (!VALID_IDENTIFIER.test(s.field)) {
      throw new Error(`Invalid field identifier: ${s.field}`);
    }
    const direction = s.direction.toUpperCase() === "DESC" ? "DESC" : "ASC";
    return `${input.nodeAlias}.${s.field} ${direction}`;
  });
  return `ORDER BY ${parts.join(", ")}`;
}
