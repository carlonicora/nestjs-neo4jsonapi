/**
 * Detect a neo4j-driver `Integer` value. The driver wraps Cypher 64-bit
 * integers in `{ low, high, toNumber() }` because JS numbers are 53-bit safe.
 *
 * Excludes composite temporals (Date, DateTime, LocalDateTime, etc.) which
 * also contain nested `Integer` fields — we recognise them by their
 * `year` / `month` / `day` / `hour` / `nanosecond` siblings and leave them
 * alone.
 */
export function isNeo4jInteger(v: unknown): v is { toNumber: () => number } {
  if (v == null || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.low === "number" &&
    typeof obj.high === "number" &&
    typeof obj.toNumber === "function" &&
    !("year" in obj) &&
    !("month" in obj) &&
    !("day" in obj) &&
    !("hour" in obj) &&
    !("nanosecond" in obj)
  );
}

/**
 * Recursively walk an object/array and unwrap any `Integer` leaf values to
 * plain JS numbers via the driver's own `.toNumber()`. Primitives, `Date`s,
 * and Neo4j temporal shapes pass through unchanged.
 *
 * Used by the framework at points where Neo4j scalars enter user-visible
 * structures without per-field type information (notably MANY-relationship
 * edge property collections).
 */
export function unwrapNeo4jIntegers<T>(value: T): T {
  if (value == null) return value;
  if (isNeo4jInteger(value)) {
    return value.toNumber() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => unwrapNeo4jIntegers(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = unwrapNeo4jIntegers(v);
    }
    return out as unknown as T;
  }
  return value;
}
