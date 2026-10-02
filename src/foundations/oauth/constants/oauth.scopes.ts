/**
 * OAuth2 Scopes
 *
 * Defines the available scopes for OAuth2 authorization.
 * Scopes control what actions an OAuth client can perform on behalf of a user.
 *
 * These are the generic built-in scopes. Apps register their own scopes on top
 * of these through `createBaseConfig({ oauthScopes: [...] })`
 * (`oauth.additionalScopes`). The helpers in this file describe the built-ins
 * only; runtime validation goes through `OAuthScopeService`, which knows both.
 *
 * @see RFC 6749 Section 3.3 - Access Token Scope
 */
export const OAuth2Scopes = {
  /** General read access to user data */
  READ: "read",

  /** General write access to user data */
  WRITE: "write",

  /** Access to user profile information (name, email) */
  PROFILE: "profile",

  /** Access to the MCP (Model Context Protocol) server */
  MCP: "mcp",

  /** Administrative access - restricted to platform admins */
  ADMIN: "admin",
} as const;

/**
 * A scope definition: the scope string plus its consent-screen label and description.
 * Used for app-specific scopes registered through config (`oauth.additionalScopes`).
 */
export interface OAuthScopeDefinition {
  /** The scope string, e.g. "documents:read" */
  scope: string;
  /** Short human-readable label for consent screens */
  name: string;
  /** Explanation of the access being granted, for consent screens */
  description: string;
}

/** Type for built-in OAuth scope values */
export type OAuthScopeType = (typeof OAuth2Scopes)[keyof typeof OAuth2Scopes];

/**
 * Array of the built-in scope strings.
 * Does not include app-specific scopes from config; use `OAuthScopeService.isValid()` at runtime.
 */
export const VALID_OAUTH_SCOPES: string[] = Object.values(OAuth2Scopes);

/**
 * Human-readable names for each scope.
 * Used in consent screens as short labels.
 */
export const OAuthScopeNames: Record<OAuthScopeType, string> = {
  [OAuth2Scopes.READ]: "Read Access",
  [OAuth2Scopes.WRITE]: "Write Access",
  [OAuth2Scopes.PROFILE]: "View Profile",
  [OAuth2Scopes.MCP]: "MCP Server Access",
  [OAuth2Scopes.ADMIN]: "Administrative Access",
};

/**
 * Human-readable descriptions for each scope.
 * Used in consent screens to explain what access is being granted.
 */
export const OAuthScopeDescriptions: Record<OAuthScopeType, string> = {
  [OAuth2Scopes.READ]: "Read access to your data",
  [OAuth2Scopes.WRITE]: "Write access to your data",
  [OAuth2Scopes.PROFILE]: "View your profile information (name, email)",
  [OAuth2Scopes.MCP]: "Let an AI assistant read and act on your data through the MCP server",
  [OAuth2Scopes.ADMIN]: "Administrative access to the platform",
};

/**
 * Validates that all requested scopes are built-in scopes.
 *
 * Built-ins only: app-specific scopes from config are rejected here.
 * Runtime validation goes through `OAuthScopeService.validate()`.
 * @param scopes - Space-separated scope string or array of scopes
 * @returns true if all scopes are valid
 */
export function validateScopes(scopes: string | string[]): boolean {
  const scopeArray = Array.isArray(scopes) ? scopes : scopes.split(" ").filter(Boolean);
  return scopeArray.every((scope) => VALID_OAUTH_SCOPES.includes(scope));
}

/**
 * Parses a space-separated scope string into an array.
 * @param scopeString - Space-separated scope string
 * @returns Array of individual scopes
 */
export function parseScopes(scopeString: string): string[] {
  return scopeString.split(" ").filter(Boolean);
}

/**
 * Checks if a set of scopes includes a specific scope.
 * @param scopes - Array of scopes to check
 * @param requiredScope - The scope to look for
 * @returns true if the required scope is present
 */
export function hasScope(scopes: string[], requiredScope: OAuthScopeType): boolean {
  return scopes.includes(requiredScope);
}
