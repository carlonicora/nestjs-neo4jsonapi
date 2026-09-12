import type { CatalogEntity } from "../interfaces/graph.catalog.interface";
import type { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";

/**
 * The one sentence every write tool's description carries, so the model knows
 * what a `kind: { type: "richtext" }` field expects. `describe_entity` says the
 * same thing per field (`format: "markdown"`), and the catalogue's inline kind
 * marker says it again in the system prompt — all three from this contract.
 */
export const RICHTEXT_HINT = "Rich-text fields (kind richtext) take markdown; it is stored as a document.";

/**
 * A BlockNote-backed field is stored as a JSON string in its own string
 * attribute — the convention every host-app entity already uses (e.g.
 * `Npc.description`: `JSON.stringify` out, `JSON.parse` back). Detect that
 * shape without trusting it: plain prose must never be mistaken for a
 * document, so this requires an array whose first entry is an object with a
 * string `type`, which is the minimal shape of a BlockNote block.
 *
 * Returns the parsed node array, or `null` when the string is not a serialised
 * BlockNote document. The single implementation: the write path uses it to
 * decide whether a value still needs converting, and the assistant uses it to
 * decide whether a user message came from a rich composer.
 */
export function parseBlockNoteDocument(raw: string): unknown[] | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const first = parsed[0] as { type?: unknown } | null;
    if (!first || typeof first !== "object" || typeof first.type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The value to STORE in a `kind: { type: "richtext" }` field.
 *
 * The read side already renders these fields to markdown for the model
 * (`ToolFieldFormatterService.renderRichtext`), so the model writes markdown
 * back. Storing that prose verbatim leaves a string the frontend then tries to
 * `JSON.parse` into BlockNote blocks, and the record cannot be rendered at all
 * ("Cannot read properties of undefined (reading 'dehydrate')"). So markdown
 * is converted to a serialised BlockNote document here, symmetrically with the
 * read.
 *
 * - a string that already IS a serialised BlockNote document: unchanged (a
 *   client-shaped payload must survive a round trip untouched);
 * - any other non-empty string: treated as markdown and converted;
 * - `null` / `undefined` / `""` and every non-string: unchanged, so clearing a
 *   field and non-text values behave exactly as before.
 */
export async function toStoredRichtext(blockNote: BlockNoteService, value: unknown): Promise<unknown> {
  if (typeof value !== "string") return value;
  if (value.trim() === "") return value;
  if (parseBlockNoteDocument(value)) return value;
  return JSON.stringify(await blockNote.createFromMarkdown(value));
}

/**
 * Applies {@link toStoredRichtext} to every field the entity's catalog marks
 * `kind: { type: "richtext" }`, returning a NEW map — the caller's own payload
 * (and therefore the approval card, which renders the model's markdown as
 * text) is never mutated.
 *
 * `blockNote` is optional so unit tests can exercise a write path without the
 * converter; without it every field passes through unchanged.
 */
export async function convertRichtextFields(
  blockNote: BlockNoteService | undefined,
  entity: CatalogEntity,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const converted: Record<string, unknown> = { ...fields };
  if (!blockNote) return converted;

  const richtext = new Set(entity.fields.filter((field) => field.kind?.type === "richtext").map((field) => field.name));
  if (!richtext.size) return converted;

  for (const name of Object.keys(converted)) {
    if (richtext.has(name)) converted[name] = await toStoredRichtext(blockNote, converted[name]);
  }
  return converted;
}
