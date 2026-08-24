import { Injectable } from "@nestjs/common";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { FieldKind } from "../../../common/interfaces/entity.schema.interface";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";

/**
 * Stage-1 (list) length default for entities with no `chat.list` declaration.
 * A rendered field whose string length exceeds this is withheld to
 * `availableOnRead` instead of emitted. A declared `chat.list` has no
 * backstop — this constant only governs the undeclared fallback.
 * (spec § "Stage rules")
 */
export const LIST_FIELD_MAX_CHARS = 200;

export type ToolFieldStage = "list" | "detail";

export interface ToolFieldsResult {
  fields: Record<string, unknown>;
  /**
   * Described, non-empty fields withheld from a list projection. Omitted
   * entirely when empty or when stage is "detail".
   */
  availableOnRead?: string[];
}

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
 * Renders a record's catalogued fields for a tool result and stages them
 * between a `list` (digest) and `detail` (complete) projection.
 *
 * Rendering runs before staging so both stages benefit: richtext fields
 * become markdown and empty values are dropped before the stage split ever
 * sees them (spec § "Rendering, then staging").
 */
@Injectable()
export class ToolFieldFormatterService {
  constructor(private readonly blockNote: BlockNoteService) {}

  build(params: { entity: CatalogEntity; record: Record<string, unknown>; stage: ToolFieldStage }): ToolFieldsResult {
    const { entity, record, stage } = params;

    // 1. Render every described field; drop empties. Declaration order is
    //    preserved because entity.fields drives the iteration.
    const rendered = new Map<string, unknown>();
    for (const f of entity.fields) {
      let value = record[f.name];
      if (f.kind?.type === "richtext") value = this.renderRichtext(value);
      if (this.isEmpty(value)) continue;
      rendered.set(f.name, value);
    }

    // 2. Stage split.
    const emitted: string[] = [];
    const withheld: string[] = [];
    if (stage === "detail") {
      emitted.push(...rendered.keys());
    } else if (entity.list) {
      for (const name of entity.list) if (rendered.has(name)) emitted.push(name);
      for (const name of rendered.keys()) if (!entity.list.includes(name)) withheld.push(name);
    } else {
      for (const [name, value] of rendered) {
        const length = typeof value === "string" ? value.length : JSON.stringify(value).length;
        (length <= LIST_FIELD_MAX_CHARS ? emitted : withheld).push(name);
      }
    }

    // 3. Emit, with money companions (both stages).
    const byName = new Map(entity.fields.map((f) => [f.name, f]));
    const fields: Record<string, unknown> = {};
    for (const name of emitted) {
      const value = rendered.get(name);
      fields[name] = value;
      const kind = byName.get(name)?.kind;
      if (kind?.type === "money") {
        const formatted = formatMoneyField(value, kind);
        if (formatted !== null) fields[`${name}_formatted`] = formatted;
      }
    }
    return withheld.length ? { fields, availableOnRead: withheld } : { fields };
  }

  /**
   * Defensive: anything that does not parse as a BlockNote node array passes
   * through unchanged rather than throwing (spec § "Rendering, then
   * staging" — malformed values must be harmless, not a 500).
   */
  private renderRichtext(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith("[")) return value;
    let nodes: unknown;
    try {
      nodes = JSON.parse(trimmed);
    } catch {
      return value;
    }
    if (!Array.isArray(nodes)) return value;
    try {
      return this.blockNote.convertToMarkdown({ nodes }).trim();
    } catch {
      return value;
    }
  }

  private isEmpty(value: unknown): boolean {
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  }
}
