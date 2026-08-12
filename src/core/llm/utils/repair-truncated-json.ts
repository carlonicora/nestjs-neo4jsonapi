/**
 * Repairs JSON that a provider cut off mid-value.
 *
 * Why this exists: when a structured call hits its output cap the provider
 * returns `finish_reason: "length"` and a payload that simply STOPS — commonly
 * inside a string, e.g.
 *
 *   {"chunks":[{"text":"…complete…"},{"text":"…trunca
 *
 * Every rung of the salvage ladder above this one hands that text to
 * `JSON.parse`, which rejects it outright, so a call that produced dozens of
 * perfectly good elements returned NOTHING. This trims back to the last element
 * that actually completed, drops the partial tail, and closes whatever
 * containers were left open — turning a total loss into an N-1 result the
 * caller's schema can validate.
 *
 * Deliberately conservative: a value is "complete" only when the input proves it
 * (a separating comma, or a closing bracket). A bare trailing token such as the
 * `3` in `[1,2,3` could itself be a truncated `35`, so it is dropped too.
 *
 * Pure and total — never throws.
 *
 * @param raw - The model's raw text. Leading prose / markdown fences are skipped
 *   up to the first `{` or `[`.
 * @returns Parseable JSON text, the input verbatim when it already parses, or
 *   `null` when nothing recoverable is present.
 */
export function repairTruncatedJson(raw: string): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  // Already valid — hand it back untouched rather than reformatting it.
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    /* continue: this is the interesting case */
  }

  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");
  const start = firstBrace < 0 ? firstBracket : firstBracket < 0 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (start < 0) return null;

  const stack: string[] = [];
  // The furthest point at which the text forms complete elements, plus the
  // containers still open there. Recorded in increasing order, so the last
  // record is always the best one.
  let safeEnd = -1;
  let safeStack: string[] = [];
  const remember = (end: number): void => {
    safeEnd = end;
    safeStack = [...stack];
  };

  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
      // An empty container is itself complete, and is the only safe point when
      // nothing inside it ever finished (`{` alone → `{}`).
      if (stack.length === 1) remember(i + 1);
    } else if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if (open !== (ch === "}" ? "{" : "[")) return null; // mismatched — not our shape
      // A closed container is a complete element of its parent.
      remember(i + 1);
      if (stack.length === 0) break; // the whole value closed
    } else if (ch === ",") {
      // Everything before the separator is a complete element of the container
      // it belongs to; the separator itself must go.
      remember(i);
    }
  }

  if (safeEnd < 0) return null;

  const closers = safeStack
    .slice()
    .reverse()
    .map((open) => (open === "{" ? "}" : "]"))
    .join("");
  const repaired = raw.slice(start, safeEnd) + closers;

  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}
