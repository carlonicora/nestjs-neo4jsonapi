/**
 * S3 key access policy: an app-provided check deciding whether the current
 * caller may act on a client-supplied object key through the `/s3` routes.
 *
 * The token is optional. When unbound, the `/s3` routes accept every
 * well-formed key, as before. Bind it from a `@Global()` application module so
 * the package `S3Module`, which imports no app modules, can resolve it.
 */

/** What the caller wants to do with the key. */
export type S3KeyAction = "upload" | "download" | "delete";

/**
 * Parameters handed to the policy for one `/s3` request.
 *
 * `userId`, `companyId` and `roles` come from the request CLS context set by
 * the JWT guard (the same values the repositories scope by).
 */
export interface S3KeyAccessParams {
  key: string;
  action: S3KeyAction;
  isPublic: boolean;
  userId?: string;
  companyId?: string;
  roles: string[];
}

/**
 * Contract implemented by an application-provided S3 key access policy.
 *
 * Return false to refuse the request (HTTP 403).
 */
export interface S3KeyAccessPolicy {
  canAccess(params: S3KeyAccessParams): boolean | Promise<boolean>;
}

/**
 * Optional injection token resolving to an S3KeyAccessPolicy.
 * When unbound, every well-formed key is accepted.
 */
export const S3_KEY_ACCESS_POLICY = Symbol("S3_KEY_ACCESS_POLICY");

/**
 * True when `key` is a well-formed object key: a non-empty string that does
 * not start with `/` and has no `..` path segment.
 *
 * MinIO, Azure and any URL-normalising proxy resolve `..` and a leading `/`
 * in the request path, so such a key can address an object outside the
 * prefix it appears to name. The `/s3` routes reject it whether or not a
 * policy is bound.
 */
export function isWellFormedS3Key(key: unknown): key is string {
  if (typeof key !== "string") return false;
  if (key.trim() === "") return false;
  if (key.startsWith("/")) return false;
  return !key.split("/").includes("..");
}
