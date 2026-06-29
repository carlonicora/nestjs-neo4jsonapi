import { BadRequestException } from "@nestjs/common";

export type Neo4jTemporalType = "date" | "datetime";

/**
 * Normalize a value for Neo4j's date() or datetime() constructor.
 *
 * Returns:
 *   type='date'     → "YYYY-MM-DD"                   (time stripped)
 *   type='datetime' → "YYYY-MM-DDTHH:mm:ss.sssZ"     (canonical ISO 8601 UTC)
 *   null            → null                           (Cypher caller MUST branch
 *                                                      with CASE WHEN IS NULL)
 *   undefined       → undefined                      (field not being written)
 *
 * Accepts:
 *   Date                            — valid JS Date
 *   "YYYY-MM-DD"                    — date-only string
 *   "YYYY-MM-DDTHH:mm:ss[.sss][Z]"  — ISO datetime (with or without ms/tz)
 *
 * Throws BadRequestException on NaN Date, unknown string shape, wrong type.
 *
 * UTC is used throughout — calendar dates must not drift across timezones.
 * Use at the repository boundary together with `date(left($v, 10))` (calendar
 * dates) or `datetime($v)` (point-in-time) in Cypher.
 */
export function normalizeNeo4jTemporal(
  value: Date | string | null | undefined,
  type: Neo4jTemporalType,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException("Invalid Date value");
    }
    return type === "datetime" ? value.toISOString() : formatDateOnlyUTC(value);
  }

  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return type === "datetime" ? new Date(`${value}T00:00:00.000Z`).toISOString() : value;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(`Invalid ISO datetime: ${value}`);
      }
      return type === "datetime" ? parsed.toISOString() : formatDateOnlyUTC(parsed);
    }
    throw new BadRequestException(`Unrecognized date/datetime string: ${value}`);
  }

  throw new BadRequestException(`Unsupported temporal value type: ${typeof value}`);
}

function formatDateOnlyUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
