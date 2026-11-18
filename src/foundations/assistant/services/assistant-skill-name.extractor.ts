/**
 * A skill named in a message: a "/" at the start of the text, at the start of a
 * line or after whitespace, then the skill name, then the end of the text,
 * whitespace or one of . , ; : ! ?
 *
 * The leading condition keeps ordinary slashes (and/or, dates, paths, URLs) from
 * naming a skill; the trailing one keeps "/emails" from naming "email".
 */
const NAMED_SKILL = /(?:^|(?<=\s))\/([a-z][a-z0-9-]{1,39})(?=$|[\s.,;:!?])/g;

/**
 * Names of the active skills the text names with "/name", in order of first
 * appearance, without duplicates. Names that are not in `activeNames` are left out.
 */
export function extractNamedSkills(text: string, activeNames: string[]): string[] {
  if (!text) return [];
  const active = new Set(activeNames);
  const found: string[] = [];
  for (const match of text.matchAll(NAMED_SKILL)) {
    const name = match[1];
    if (active.has(name) && !found.includes(name)) found.push(name);
  }
  return found;
}
