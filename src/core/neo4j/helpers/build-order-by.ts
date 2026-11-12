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
 * The clause ends with `<alias>.id ASC` (unless the ordered field is `id`) so rows
 * sharing the ordered value keep a stable order across pages.
 */
export function buildLegacyOrderByClause(input: { nodeAlias: string; orderBy?: string; fallback?: string }): string {
  if (!VALID_IDENTIFIER.test(input.nodeAlias)) {
    throw new Error(`Invalid nodeAlias identifier: ${input.nodeAlias}`);
  }
  const value = [input.orderBy, input.fallback, "updatedAt DESC"].map((v) => v?.trim()).find((v) => !!v) as string;
  const match = LEGACY_ORDER_BY.exec(value);
  if (!match) throw new BadRequestException("Invalid orderBy");

  const direction = match[2] ? ` ${match[2].toUpperCase()}` : "";
  const tiebreaker = match[1] === "id" ? "" : `, ${input.nodeAlias}.id ASC`;
  return `ORDER BY ${input.nodeAlias}.${match[1]}${direction}${tiebreaker}`;
}

/**
 * A code-authored ORDER BY body (e.g. `"task.dueDate IS NULL, task.dueDate ASC"`). Only
 * {@link codeOrderBy} creates one, so a request value can never be passed where it is expected.
 */
export type CodeOrderBy = string & { readonly __codeOrderBy: true };

/**
 * Marks a string literal written in a repository as a code-authored ORDER BY body.
 * Call it only with literals in code, never with request data, and never cast a string to
 * {@link CodeOrderBy} instead.
 *
 * @param text - The ORDER BY body without the `ORDER BY` keyword.
 */
export function codeOrderBy(text: string): CodeOrderBy {
  if (!text.trim()) throw new Error("codeOrderBy needs a non-empty ORDER BY body");
  return text as CodeOrderBy;
}

/**
 * The ORDER BY key for a requested sort on `property` (`alias.field`): text is compared
 * lowercased, so "Zurich" and "zoom" sort together; numbers, dates, booleans and empty values
 * keep their own order. `property` must be code-built (`<alias>.<field>` from validated
 * identifiers), never request text.
 */
export function caseInsensitiveSortKey(property: string): string {
  const field = property.slice(property.lastIndexOf(".") + 1);
  if (NEVER_TEXT_FIELDS.includes(field)) return property;
  return `CASE WHEN ${property} IS :: STRING THEN toLower(${property}) ELSE ${property} END`;
}

/** Fields that are never mixed-case text: ids are lowercase UUIDs, the timestamps are datetimes. */
const NEVER_TEXT_FIELDS: readonly string[] = ["id", "createdAt", "updatedAt"];

/**
 * The ORDER BY clause for validated sort criteria (from {@link parseJsonApiSort} or code).
 * Appends `<alias>.id ASC` as the last key, unless the last criterion is already `id`, so rows
 * sharing the sorted value keep a stable order across pages. Returns "" for an empty list.
 */
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
    return `${caseInsensitiveSortKey(`${input.nodeAlias}.${s.field}`)} ${direction}`;
  });
  if (input.sort[input.sort.length - 1].field !== "id") parts.push(`${input.nodeAlias}.id ASC`);
  return `ORDER BY ${parts.join(", ")}`;
}

/**
 * The ORDER BY clause of a paginated list query. Always ends with `<alias>.id ASC`.
 *
 * - With `sort`: `ORDER BY <keys>[, <score> DESC], <alias>.id ASC`. A key is
 *   `expressions[field] ?? <alias>.<field>` plus its direction; the score follows the keys
 *   when the query searched (a header sort reorders the search results).
 * - Without `sort` and with `scoreVariable`: `ORDER BY <score> DESC, <alias>.id ASC`.
 * - Otherwise: `ORDER BY <defaultOrderBy>, <alias>.id ASC`.
 *
 * Every `sort` field must be a plain identifier (validated here; {@link parseJsonApiSort}
 * returns only code-held keys). `defaultOrderBy` and `expressions` are code-authored.
 * The `{CURSOR}` placeholder follows this clause in the query.
 */
export function buildListOrderByClause(input: {
  nodeAlias: string;
  sort?: SortCriterion[];
  /** Code-authored ORDER BY body used when no sort is requested. Never request data. */
  defaultOrderBy: CodeOrderBy;
  /** Cypher variable holding the fulltext score, when the query searched. */
  scoreVariable?: string;
  /** Code-authored expressions for sort fields that are not a plain property (e.g. Task priority rank). */
  expressions?: Record<string, CodeOrderBy>;
}): string {
  if (!VALID_IDENTIFIER.test(input.nodeAlias)) {
    throw new Error(`Invalid nodeAlias identifier: ${input.nodeAlias}`);
  }
  if (input.scoreVariable !== undefined && !VALID_IDENTIFIER.test(input.scoreVariable)) {
    throw new Error(`Invalid scoreVariable identifier: ${input.scoreVariable}`);
  }

  const tiebreaker = `${input.nodeAlias}.id ASC`;
  const score = input.scoreVariable ? [`${input.scoreVariable} DESC`] : [];

  if (!input.sort?.length) {
    const head = score.length ? score : [input.defaultOrderBy];
    return `ORDER BY ${[...head, tiebreaker].join(", ")}`;
  }

  const expressions = input.expressions ?? {};
  const keys = input.sort.map((s) => {
    if (!VALID_IDENTIFIER.test(s.field)) {
      throw new Error(`Invalid field identifier: ${s.field}`);
    }
    const direction = s.direction.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const expression = Object.prototype.hasOwnProperty.call(expressions, s.field)
      ? expressions[s.field]
      : caseInsensitiveSortKey(`${input.nodeAlias}.${s.field}`);
    return `${expression} ${direction}`;
  });

  const parts = [...keys, ...score];
  const last = input.sort[input.sort.length - 1];
  const endsWithId = !score.length && last.field === "id" && !Object.prototype.hasOwnProperty.call(expressions, "id");
  if (!endsWithId) parts.push(tiebreaker);
  return `ORDER BY ${parts.join(", ")}`;
}
