/**
 * The six metric fields every token-usage reporting resource exposes.
 *
 * Declared once and spread into all six descriptors (three administrative,
 * three self-service) so the two surfaces cannot drift apart. Spreading a shared
 * `fields` object is an established pattern in this codebase — a consuming app's
 * ExtendedTokenUsageDescriptor already does `fields: { ...TokenUsageDescriptor.fields }`.
 *
 * The `as const` is per FIELD, not on the whole object: it pins `type` to a
 * string literal (which defineEntity needs to infer the entity shape) while
 * leaving each field object mutable, which a whole-object `as const` would not.
 */
export const usageMetricFields = {
  cost: { type: "number" as const, required: true },
  credits: { type: "number" as const, required: true },
  tokensIn: { type: "number" as const, required: true },
  tokensOut: { type: "number" as const, required: true },
  cached: { type: "number" as const, required: true },
  calls: { type: "number" as const, required: true },
};

/** The metric half of every reporting entity type. */
export type UsageMetrics = {
  cost: number;
  credits: number;
  tokensIn: number;
  tokensOut: number;
  cached: number;
  calls: number;
};
