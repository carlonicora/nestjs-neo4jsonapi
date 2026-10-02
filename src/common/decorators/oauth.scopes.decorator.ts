import { SetMetadata } from "@nestjs/common";

/**
 * Metadata key for OAuth scopes
 */
export const OAUTH_SCOPES_KEY = "oauth_scopes";

/**
 * Decorator to specify required OAuth scopes for an endpoint.
 *
 * Use with OAuthTokenGuard to enforce scope requirements.
 *
 * @example
 * @UseGuards(OAuthTokenGuard)
 * @OAuthScopes('read', 'write')
 * async updateDocument() { ... }
 *
 * @param scopes - Required OAuth scopes
 */
export const OAuthScopes = (...scopes: string[]) => SetMetadata(OAUTH_SCOPES_KEY, scopes);
