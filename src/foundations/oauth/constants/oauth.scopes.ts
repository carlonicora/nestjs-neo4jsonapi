/**
 * OAuth2 Scopes
 *
 * Defines the available scopes for OAuth2 authorization.
 * Scopes control what actions an OAuth client can perform on behalf of a user.
 *
 * @see RFC 6749 Section 3.3 - Access Token Scope
 */
export const OAuth2Scopes = {
  /** General read access to user data */
  READ: "read",

  /** General write access to user data */
  WRITE: "write",

  /** Read access to photographs */
  PHOTOGRAPHS_READ: "photographs:read",

  /** Create and modify photographs */
  PHOTOGRAPHS_WRITE: "photographs:write",

  /** Read access to rolls/albums */
  ROLLS_READ: "rolls:read",

  /** Create and modify rolls/albums */
  ROLLS_WRITE: "rolls:write",

  /** Access to user profile information (name, email) */
  PROFILE: "profile",

  /** Access to the MCP (Model Context Protocol) server */
  MCP: "mcp",

  /** Administrative access - restricted to platform admins */
  ADMIN: "admin",
} as const;

/** Type for valid OAuth scope values */
export type OAuthScopeType = (typeof OAuth2Scopes)[keyof typeof OAuth2Scopes];

/** Array of all valid scope strings */
export const VALID_OAUTH_SCOPES: string[] = Object.values(OAuth2Scopes);

/**
 * Human-readable names for each scope.
 * Used in consent screens as short labels.
 */
export const OAuthScopeNames: Record<OAuthScopeType, string> = {
  [OAuth2Scopes.READ]: "Read Access",
  [OAuth2Scopes.WRITE]: "Write Access",
  [OAuth2Scopes.PHOTOGRAPHS_READ]: "View Photographs",
  [OAuth2Scopes.PHOTOGRAPHS_WRITE]: "Upload Photographs",
  [OAuth2Scopes.ROLLS_READ]: "View Rolls",
  [OAuth2Scopes.ROLLS_WRITE]: "Manage Rolls",
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
  [OAuth2Scopes.PHOTOGRAPHS_READ]: "View your photographs",
  [OAuth2Scopes.PHOTOGRAPHS_WRITE]: "Upload and modify your photographs",
  [OAuth2Scopes.ROLLS_READ]: "View your rolls and albums",
  [OAuth2Scopes.ROLLS_WRITE]: "Create and modify rolls and albums",
  [OAuth2Scopes.PROFILE]: "View your profile information (name, email)",
  [OAuth2Scopes.MCP]: "Let an AI assistant read and act on your data through the MCP server",
  [OAuth2Scopes.ADMIN]: "Administrative access to the platform",
};

/**
 * Validates that all requested scopes are valid.
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
