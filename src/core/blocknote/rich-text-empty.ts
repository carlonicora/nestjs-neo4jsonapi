/**
 * Server-side twin of the web editor's emptiness rule
 * (packages/nextjs-jsonapi/src/components/editors/BlockNoteEditor.tsx).
 * A BlockNote document that the user has cleared still serialises as one
 * blank paragraph, so a Cypher aggregate cannot tell "never written" from
 * "written". Services normalise an empty rich-text attribute to null with
 * emptyRichTextToNull before the framework writes it.
 */
function isBlockEmpty(block: any): boolean {
  if (!block || typeof block !== "object") return true;
  if (block.type !== "paragraph") return false;
  if (Array.isArray(block.children) && block.children.length > 0 && !isDocumentEmpty(block.children)) {
    return false;
  }
  if (Array.isArray(block.content)) {
    for (const inline of block.content) {
      if (typeof inline === "string") {
        if (inline.trim()) return false;
      } else if (inline && typeof inline === "object") {
        if (inline.type !== "text") return false;
        if (typeof inline.text === "string" && inline.text.trim()) return false;
      }
    }
  } else if (typeof block.content === "string" && block.content.trim()) {
    return false;
  }
  return true;
}

export function isDocumentEmpty(blocks: unknown): boolean {
  if (!Array.isArray(blocks) || blocks.length === 0) return true;
  return blocks.every(isBlockEmpty);
}

/**
 * Returns null when the wire value (a JSON string of blocks) is an empty
 * document, otherwise the value untouched. Unparseable input counts as empty.
 */
export function emptyRichTextToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return isDocumentEmpty(JSON.parse(value)) ? null : value;
  } catch {
    return null;
  }
}
