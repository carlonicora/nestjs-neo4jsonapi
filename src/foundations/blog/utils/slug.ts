const MAX_SLUG_LENGTH = 80;
const EMPTY_SLUG = "post";

/**
 * Lowercase kebab-case ASCII slug: diacritics stripped (NFKD), every run of characters outside
 * [a-z0-9] collapsed to one dash, dashes trimmed from both ends, at most 80 characters.
 * Returns "post" when nothing usable is left.
 */
export function slugify(text: string): string {
  const slug = (text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : EMPTY_SLUG;
}

/**
 * Returns `base` when it is free, otherwise the first free `base-2`, `base-3`, ...
 * `taken` is the list of slugs already used in the same language.
 */
export function uniqueSlug(base: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}
