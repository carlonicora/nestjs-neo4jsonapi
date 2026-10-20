/**
 * Where a visitor came from before signing up (first touch).
 * Stored on waitlist entries and users; every key is optional.
 */
export type SignupSource = {
  sourceRef?: string;
  sourceUtmSource?: string;
  sourceUtmMedium?: string;
  sourceUtmCampaign?: string;
  sourceReferrer?: string;
  sourceLandingPath?: string;
};

export const SIGNUP_SOURCE_FIELDS: readonly (keyof SignupSource)[] = [
  "sourceRef",
  "sourceUtmSource",
  "sourceUtmMedium",
  "sourceUtmCampaign",
  "sourceReferrer",
  "sourceLandingPath",
];

export const SIGNUP_SOURCE_MAX_LENGTH = 200;

const SIGNUP_SOURCE_PARAM_MAX_LENGTH = 4096;

/**
 * Picks the six keys, keeps non-empty trimmed strings, truncates to 200; undefined when nothing is left.
 */
export function sanitiseSignupSource(input: unknown): SignupSource | undefined {
  if (!input || typeof input !== "object") return undefined;

  const record = input as Record<string, unknown>;
  const source: SignupSource = {};

  for (const field of SIGNUP_SOURCE_FIELDS) {
    const value = record[field];
    if (typeof value !== "string") continue;

    const trimmed = value.trim();
    if (!trimmed) continue;

    source[field] = trimmed.slice(0, SIGNUP_SOURCE_MAX_LENGTH);
  }

  return Object.keys(source).length > 0 ? source : undefined;
}

/**
 * JSON.parse inside try/catch, rejects strings over 4096 chars, then sanitiseSignupSource.
 */
export function parseSignupSourceParam(raw?: string): SignupSource | undefined {
  if (!raw || raw.length > SIGNUP_SOURCE_PARAM_MAX_LENGTH) return undefined;

  try {
    return sanitiseSignupSource(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function hasSignupSource(record?: Partial<SignupSource> | null): boolean {
  return sanitiseSignupSource(record) !== undefined;
}
