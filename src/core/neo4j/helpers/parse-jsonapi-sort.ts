import { BadRequestException } from "@nestjs/common";
import { SortCriterion } from "../types/filter.criterion";

/** The most keys one `sort` may name. */
const MAX_SORT_KEYS = 5;

const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Timestamps every entity stores; sortable without a descriptor flag. */
const ALWAYS_SORTABLE: readonly string[] = ["createdAt", "updatedAt"];

/**
 * Parses a JSON:API `sort` request value (`?sort=-publicationDate,name`) into validated sort criteria.
 *
 * - `undefined` or an empty value → `undefined` (no sort requested).
 * - Keys are comma-separated and trimmed; a `-` prefix means descending, no prefix ascending.
 * - A key is accepted only when it is a descriptor field marked `sortable: true`, `createdAt` /
 *   `updatedAt`, or a name in `allow`. Anything else (unknown field, a field without the opt-in,
 *   a computed value, an injection string, an empty key, a repeated field, more than five keys,
 *   a non-string value) throws `BadRequestException("Invalid sort")`.
 *
 * Every returned `field` is the code-held key that matched (descriptor key, allow-list entry or
 * timestamp constant), never a substring of the request, so no request text reaches Cypher.
 *
 * @param params.sort - The raw request value.
 * @param params.descriptor - The entity descriptor whose `sortable` fields are accepted.
 * @param params.allow - Extra code-held field names this list accepts (repositories without a descriptor field).
 * @returns The criteria in request order, or `undefined` when no sort was requested.
 */
export function parseJsonApiSort(params: {
  sort?: string;
  descriptor?: { fields: Record<string, { sortable?: boolean } | undefined> };
  allow?: readonly string[];
}): SortCriterion[] | undefined {
  const raw: unknown = params.sort;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw invalidSort();
  if (raw.trim() === "") return undefined;

  const keys = raw.split(",").map((key) => key.trim());
  if (keys.length > MAX_SORT_KEYS) throw invalidSort();

  const seen = new Set<string>();
  return keys.map((key) => {
    const direction: SortCriterion["direction"] = key.startsWith("-") ? "desc" : "asc";
    const name = direction === "desc" ? key.slice(1) : key;
    if (!VALID_IDENTIFIER.test(name)) throw invalidSort();

    const field = matchSortableField(name, params.descriptor, params.allow);
    if (field === undefined || seen.has(field)) throw invalidSort();
    seen.add(field);

    return { field, direction };
  });
}

/** The code-held key equal to `name`, or `undefined` when `name` is not sortable. */
function matchSortableField(
  name: string,
  descriptor: { fields: Record<string, { sortable?: boolean } | undefined> } | undefined,
  allow: readonly string[] | undefined,
): string | undefined {
  const fields = descriptor?.fields ?? {};
  const descriptorKey = Object.keys(fields).find((key) => key === name && fields[key]?.sortable === true);
  return descriptorKey ?? ALWAYS_SORTABLE.find((key) => key === name) ?? (allow ?? []).find((key) => key === name);
}

function invalidSort(): BadRequestException {
  return new BadRequestException("Invalid sort");
}
