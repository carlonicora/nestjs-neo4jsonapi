const WORDS_PER_MINUTE = 200;

/**
 * Reading time in whole minutes at 200 words per minute, never less than 1.
 */
export function readingMinutes(plainText: string): number {
  const words = (plainText ?? "").split(/\s+/).filter((word) => word.length > 0).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
