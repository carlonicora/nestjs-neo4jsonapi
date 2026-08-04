import type { ExecutionContext } from "@nestjs/common";

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

/**
 * Optional hook invoked by `JwtAuthGuard` after a request has been successfully
 * authenticated. Applications provide it to enrich the request context with
 * application-specific data (extra CLS values, membership lookups, ...) without
 * forking the guard.
 *
 * When no provider is registered the guard behaves exactly as before.
 * Errors thrown by the hook propagate to the caller (e.g. throw
 * `new HttpException("Unauthorised", 401)` to reject the request).
 */
export const AUTH_CONTEXT_HOOK = Symbol("AUTH_CONTEXT_HOOK");

/**
 * Contract implemented by an application-provided authentication context hook.
 */
export interface AuthContextHookInterface {
  onAuthenticated(params: { request: any; context: ExecutionContext }): Promise<void> | void;
}
