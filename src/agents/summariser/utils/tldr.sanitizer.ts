/**
 * Strips markdown syntax from a string and returns plain text.
 *
 * Used by SummariserService to guarantee that the `tldr` returned from the LLM
 * is plain text regardless of whether the model emits markdown formatting.
 *
 * Transformation pipeline (order matters — see spec for rationale):
 *   1. Unwrap markdown images:  ![alt](url) -> alt
 *   2. Unwrap markdown links:   [text](url) -> text
 *   3. Strip line-leading block markers (#, -, *, +, >, 1.) at line starts
 *   4. Remove horizontal-rule lines entirely
 *   5. Strip inline emphasis markers: **, __, ~~, *, _, `
 *   6. Collapse any run of whitespace (including newlines) to a single space, then trim
 *
 * Idempotent: sanitizeTldr(sanitizeTldr(x)) === sanitizeTldr(x).
 */
export const sanitizeTldr = (input: string): string => {
  if (!input) return "";

  let s = input;

  // 1. Unwrap markdown images: ![alt](url) -> alt
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // 2. Unwrap markdown links: [text](url) -> text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // 3. Strip line-leading block markers (headings, bullets, ordered lists, blockquotes)
  //    Multiline flag so ^ matches the start of each line.
  s = s.replace(/^[ \t]*(#{1,6}[ \t]+|[-*+>][ \t]+|\d+\.[ \t]+)/gm, "");

  // 4. Remove whole horizontal-rule lines (--- / *** / ___)
  s = s.replace(/^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "");

  // 5. Strip inline emphasis markers. Multi-char tokens first so single-char
  //    strippers don't nibble half of them.
  s = s.replace(/\*\*/g, "");
  s = s.replace(/__/g, "");
  s = s.replace(/~~/g, "");
  s = s.replace(/[*_`]/g, "");

  // 6. Collapse whitespace runs (including newlines left behind by step 4) and trim.
  s = s.replace(/\s+/g, " ").trim();

  return s;
};
