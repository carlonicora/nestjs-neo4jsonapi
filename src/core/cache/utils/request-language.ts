/**
 * Normalises a raw request language (the `x-language` header, or the CLS
 * "language" value) to the form the API reads: trimmed, lowercased, the part
 * before the first "-" or "_". A missing or empty value is "en". An array (a
 * repeated HTTP header) uses its first item.
 */
export function normaliseRequestLanguage(raw?: string | string[] | null): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const language = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return language || "en";
}
