import { CatalogField } from "../interfaces/graph.catalog.interface";
import { FieldKind } from "../../../common/interfaces/entity.schema.interface";

/**
 * Format a money field's raw minor-unit integer as a decimal string the LLM
 * can safely quote to the user (e.g. 600 with minorUnits=2 → "6.00").
 * Returns null when the value is not a finite number so callers can skip
 * emitting a companion key for missing / null values.
 */
export function formatMoneyField(value: unknown, kind: FieldKind): string | null {
  if (kind.type !== "money") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const minor = kind.minorUnits ?? 2;
  if (minor === 0) return String(Math.trunc(value));
  const factor = 10 ** minor;
  return (value / factor).toFixed(minor);
}

/**
 * Build the `fields` object a tool returns to the LLM for one record.
 * Emits the raw scalar for every catalogued field, and for money fields
 * also emits a sibling `<name>_formatted` decimal string alongside the raw
 * integer. The sibling name mirrors the prompt's documented convention so
 * the LLM quotes the formatted string instead of the raw minor-unit integer.
 */
export function buildToolFieldsOutput(
  fields: CatalogField[],
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const value = record[f.name];
    out[f.name] = value;
    if (f.kind?.type === "money") {
      const formatted = formatMoneyField(value, f.kind);
      if (formatted !== null) {
        out[`${f.name}_formatted`] = formatted;
      }
    }
  }
  return out;
}
