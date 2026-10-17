/**
 * Builds the single English system line that tells the model which language to
 * write its human-readable output in. Prompts stay English; this line is the
 * only language-dependent prompt text.
 *
 * Returns `undefined` for English (and for an empty or unknown code), so
 * English output stays byte-identical to a call without the line.
 *
 * The line must never contain curly braces: system prompts are parsed as
 * prompt templates, and a brace would be read as a template variable.
 */
export function buildResponseLanguageInstruction(language: string): string | undefined {
  if (!language || language === "en") return undefined;

  let name: string | undefined;
  try {
    name = new Intl.DisplayNames(["en"], { type: "language" }).of(language);
  } catch {
    return undefined;
  }
  if (!name || name === language) return undefined;

  return (
    "Write every human-readable text value of your response in " +
    name +
    ". Keep unchanged: identifiers, enum values, schema keys, timestamps, any text the instructions or field descriptions say to copy exactly, and the names of existing people, places and things."
  );
}
