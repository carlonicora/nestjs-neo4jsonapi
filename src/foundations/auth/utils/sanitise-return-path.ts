// Only home and Settings (optionally one section) finish a Discord connect.
const ALLOWED_RETURN_PATH = /^\/(settings(\?section=[a-z0-9-]+)?)?$/;

/**
 * The return path a Discord connect goes back to: exactly `/`, `/settings` or
 * `/settings?section=<[a-z0-9-]+>`; anything else becomes `/`. Locale-free: the web proxy adds the locale.
 */
export function sanitiseReturnPath(returnPath: string | undefined): string {
  return typeof returnPath === "string" && ALLOWED_RETURN_PATH.test(returnPath) ? returnPath : "/";
}
