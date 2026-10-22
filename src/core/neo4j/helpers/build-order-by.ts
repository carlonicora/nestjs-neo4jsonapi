import { BadRequestException } from "@nestjs/common";
import { SortCriterion } from "../types/filter.criterion";

const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One property name, optionally followed by ASC or DESC: the only shape a legacy orderBy may take. */
const LEGACY_ORDER_BY = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?$/i;

/**
 * The ORDER BY clause for a legacy `orderBy` string ("name", "createdAt DESC").
 * The string often comes straight from a request's `?orderBy=` and lands in
 * the Cypher text, so anything other than one property name and an optional
 * direction is refused (400): before this check, `?orderBy=` was a Cypher
 * injection. The first non-empty of `orderBy`, `fallback`, "updatedAt DESC" wins.
 */
export function buildLegacyOrderByClause(input: { nodeAlias: string; orderBy?: string; fallback?: string }): string {
  if (!VALID_IDENTIFIER.test(input.nodeAlias)) {
    throw new Error(`Invalid nodeAlias identifier: ${input.nodeAlias}`);
  }
  const value = [input.orderBy, input.fallback, "updatedAt DESC"].map((v) => v?.trim()).find((v) => !!v) as string;
  const match = LEGACY_ORDER_BY.exec(value);
  if (!match) throw new BadRequestException("Invalid orderBy");

  const direction = match[2] ? ` ${match[2].toUpperCase()}` : "";
  return `ORDER BY ${input.nodeAlias}.${match[1]}${direction}`;
}

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
