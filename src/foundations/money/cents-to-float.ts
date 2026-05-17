/**
 * Convert a Neo4j-returned cents value to a JSON:API float.
 * Handles both neo4j-driver Integer wrappers (with .toNumber()) and plain numbers.
 */
export function centsToFloat(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber() / 100;
  }
  return Number(value) / 100;
}
