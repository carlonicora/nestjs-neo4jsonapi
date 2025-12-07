/**
 * Injection tokens for common module dependencies
 *
 * NOTE: Logging is done via AppLoggingService directly, no token needed.
 */

// System roles provider token
export const SYSTEM_ROLES = Symbol("SYSTEM_ROLES");

/**
 * Interface for system roles
 */
export interface SystemRolesInterface {
  Administrator: string;
  [key: string]: string;
}
