/**
 * Client context: a small, opaque set of string values a client attaches to
 * one user message of an assistant thread (e.g. what the user is looking at
 * when they send it).
 *
 * The library never interprets the keys. It validates the shape, stores the
 * object on the user message as a JSON string (`AssistantMessage.clientContext`)
 * and hands it to the host's seed-context providers and to the operator tool
 * context of the turn that message starts.
 */

/** Opaque context a client attaches to one user message. String values only. */
export type AssistantClientContext = Record<string, string>;

/** Size limits of a client context. */
export const ASSISTANT_CLIENT_CONTEXT_LIMITS = { maxKeys: 8, maxKeyLength: 64, maxValueLength: 256 } as const;

/**
 * True for a plain object with at most `maxKeys` entries, every key 1..`maxKeyLength`
 * characters and every value a string of at most `maxValueLength` characters.
 */
export function isAssistantClientContext(value: unknown): value is AssistantClientContext {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > ASSISTANT_CLIENT_CONTEXT_LIMITS.maxKeys) return false;
  return entries.every(
    ([key, entry]) =>
      key.length >= 1 &&
      key.length <= ASSISTANT_CLIENT_CONTEXT_LIMITS.maxKeyLength &&
      typeof entry === "string" &&
      entry.length <= ASSISTANT_CLIENT_CONTEXT_LIMITS.maxValueLength,
  );
}

/**
 * Reads a client context stored as a JSON string. Undefined when absent, when the
 * JSON is invalid, or when the parsed value fails `isAssistantClientContext`.
 */
export function parseAssistantClientContext(stored: string | null | undefined): AssistantClientContext | undefined {
  if (!stored) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isAssistantClientContext(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
