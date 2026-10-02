/**
 * Inline entity links in user-facing answers.
 *
 * The responder never sees UUIDs: entities reach it as opaque `ref:N` handles
 * (see the "entities for citation" block in the answer node). When an app opts
 * in, the synthesizer may write `[Name](ref:N)` inside `finalAnswer`; these
 * helpers turn that into `[Name](mention://type/id)` after the call, and strip
 * mention links that point at entities the caller does not allow.
 */

const REF_LINK = /\[([^\]\n]*)\]\(\s*ref:(\d+)\s*\)/g;
const MENTION_LINK = /\[([^\]\n]*)\]\(\s*mention:\/\/([^/\s)]+)\/([^\s)]+)\s*\)/g;

/** [Text](ref:N) → [Text](mention://type/id) via byRef; unknown handle → plain Text. */
export function resolveRefLinks(answer: string, byRef: Map<string, { type: string; id: string }>): string {
  if (!answer) return answer;
  return answer.replace(REF_LINK, (_match, text: string, n: string) => {
    const hit = byRef.get(`ref:${n}`);
    if (!hit) return text;
    return `[${text}](mention://${hit.type}/${hit.id})`;
  });
}

/** Keeps [Text](mention://type/id) only when isAllowed(type,id); otherwise plain Text. Other links untouched. */
export function sanitiseMentionLinks(answer: string, isAllowed: (type: string, id: string) => boolean): string {
  if (!answer) return answer;
  return answer.replace(MENTION_LINK, (match, text: string, type: string, id: string) =>
    isAllowed(type, id) ? match : text,
  );
}

/**
 * Extra system instruction appended to the responder answer prompt when the
 * app enables inline entity links. Plain prose: no backticks, no placeholders.
 */
export const RESPONDER_INLINE_LINKS_INSTRUCTION = `
## Inline entity links

When finalAnswer names an entity that is listed in an "entities for citation"
block of graphSection or seedSection, write that name as a markdown link whose
target is the entity's exact handle, without the square brackets around the
handle. For example, for the listed entity [ref:3], write [Mario Rossi](ref:3).

This overrides the rule that finalAnswer must not contain handles, for this
markdown link form only. Handles must never appear in finalAnswer in any other
form, and never in title.

Never use a handle that is not listed in an "entities for citation" block.
Never invent a handle. Link each entity by the name the user would recognise.
Still list every entity the answer relies on in references as usual.

The link text must be the listed entity's own name or title, and the entity
must be the thing that text refers to. A record that only mentions or is about
something else is not that thing: a document about a company is a document, so
never put the company's name on the document's handle. When the thing named has
no handle of its own in the list, write its name as plain text with no link.
`;
