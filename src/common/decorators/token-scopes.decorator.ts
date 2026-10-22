import { SetMetadata } from "@nestjs/common";
import type { TokenScope } from "../guards/session.token";

/** Metadata key read by `AnyScopeAuthGuard`. */
export const TOKEN_SCOPES_KEY = "token_scopes";

/**
 * The selection-token scopes `AnyScopeAuthGuard` admits on a route, besides a full
 * session. Without this decorator the guard admits a full session only.
 *
 * @example
 * @UseGuards(AnyScopeAuthGuard)
 * @AllowedTokenScopes("company-selection")
 * async selectCompany() { ... }
 */
export const AllowedTokenScopes = (...scopes: TokenScope[]) => SetMetadata(TOKEN_SCOPES_KEY, scopes);
