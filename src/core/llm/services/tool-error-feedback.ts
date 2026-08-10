/**
 * Feedback for tool calls the model gets wrong.
 *
 * A tool whose arguments fail schema validation is rejected by LangChain BEFORE
 * the tool's own code runs, so the model receives the generic
 * "Received tool input did not match expected schema" and has nothing to act
 * on. Small models respond by re-emitting the identical call until the
 * iteration budget is gone — one observed run burned 14 of 15 iterations and
 * 108k input tokens repeating a `read_entity` call that was missing `type`.
 *
 * These helpers replace that dead end with the same imperative phrasing the
 * graph tools already use for their own errors, and give the caller a way to
 * detect a call that is looping.
 */

/** Identical failing calls tolerated before the tool loop is abandoned. */
export const REPEATED_TOOL_FAILURE_LIMIT = 3;

/** Recursively sort object keys so key order cannot disguise an identical call. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = canonicalise(source[key]);
  return sorted;
}

/**
 * Stable identity for a tool call. Models re-emit the same arguments with the
 * keys in a different order — `{id, include}` one iteration, `{include, id}`
 * the next — so the signature must be key-order independent or a loop reads as
 * a series of distinct calls.
 */
export function toolCallSignature(name: string, args: unknown): string {
  try {
    return `${name}:${JSON.stringify(canonicalise(args))}`;
  } catch {
    return `${name}:${String(args)}`;
  }
}

/** The zod object shape, across the several places zod versions keep it. */
function shapeOf(schema: unknown): Record<string, unknown> | null {
  const candidate = schema as { shape?: unknown; _def?: { shape?: unknown }; def?: { shape?: unknown } };
  const raw = candidate?.shape ?? candidate?._def?.shape ?? candidate?.def?.shape;
  const resolved = typeof raw === "function" ? (raw as () => unknown)() : raw;
  return resolved && typeof resolved === "object" ? (resolved as Record<string, unknown>) : null;
}

function requiredArgumentNames(schema: unknown): string[] {
  const shape = shapeOf(schema);
  if (!shape) return [];
  return Object.entries(shape)
    .filter(([, field]) => {
      const parse = (field as { safeParse?: (v: unknown) => { success: boolean } })?.safeParse;
      // A field that rejects `undefined` is required.
      return typeof parse === "function" ? !parse.call(field, undefined).success : false;
    })
    .map(([name]) => name);
}

function valueAtPath(args: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let cursor: unknown = args;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<PropertyKey, unknown>)[key];
  }
  return cursor;
}

/**
 * Explain, in the tool's own terms, why its arguments were rejected. Returns
 * null when the schema cannot be introspected or the arguments actually
 * validate — in both cases the caller should fall back to the raw error, since
 * the rejection came from somewhere else.
 */
export function describeToolInputRejection(params: {
  toolName: string;
  schema: unknown;
  args: unknown;
}): string | null {
  const schema = params.schema as { safeParse?: (value: unknown) => any } | undefined;
  if (!schema || typeof schema.safeParse !== "function") return null;

  const result = schema.safeParse(params.args);
  if (result?.success !== false) return null;

  const missing: string[] = [];
  const invalid: string[] = [];
  const unexpected: string[] = [];

  for (const issue of result.error?.issues ?? []) {
    if (issue.code === "unrecognized_keys") {
      unexpected.push(...(issue.keys ?? []).map((k: string) => `"${k}"`));
      continue;
    }
    const path = (issue.path ?? []) as PropertyKey[];
    const name = path.length ? path.join(".") : "(whole argument object)";
    if (valueAtPath(params.args, path) === undefined) {
      missing.push(issue.expected ? `"${name}" (expected ${issue.expected})` : `"${name}"`);
    } else {
      invalid.push(`"${name}" — ${issue.message}`);
    }
  }

  const required = requiredArgumentNames(schema);
  const lines = [
    `Tool error: the call to "${params.toolName}" was rejected before it ran — its arguments did not match the tool's schema.`,
  ];
  if (missing.length) lines.push(`Missing required argument ${missing.join(", ")}.`);
  if (invalid.length) lines.push(`Invalid argument ${invalid.join(", ")}.`);
  if (unexpected.length) lines.push(`Unexpected argument ${unexpected.join(", ")} — remove it.`);
  if (required.length) lines.push(`Required arguments for ${params.toolName}: ${required.join(", ")}.`);
  // Imperative, never question-shaped: a small model relays a question to the
  // user instead of retrying, which is exactly the failure this message exists
  // to prevent.
  lines.push(`Reissue ${params.toolName} now with every required argument present. Do not resend the same arguments.`);

  return lines.join(" ");
}

/** Final word to the model when the same rejected call keeps coming back. */
export function repeatedToolFailureMessage(params: { toolName: string; attempts: number }): string {
  return (
    `Tool error: "${params.toolName}" has now been called ${params.attempts} times with the same invalid arguments ` +
    `and was rejected every time. Stop calling "${params.toolName}" with those arguments. ` +
    `Answer from the data already gathered, or call a different tool with corrected arguments.`
  );
}
