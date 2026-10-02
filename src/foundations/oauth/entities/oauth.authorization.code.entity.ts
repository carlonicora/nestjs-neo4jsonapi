import { Entity } from "../../../common/abstracts/entity";
import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * OAuth Authorization Code Entity
 *
 * Temporary authorization code used in the Authorization Code Grant flow.
 * Codes are single-use and expire after a short period (typically 10 minutes).
 * Internal use only - not exposed via JSON:API.
 */
export type OAuthAuthorizationCode = Entity & {
  /** SHA256 hash of the authorization code */
  codeHash: string;

  /** When this code expires */
  expiresAt: Date;

  /** Redirect URI that was used in the authorization request */
  redirectUri: string;

  /** Space-separated scope string */
  scope: string;

  /** CSRF state parameter (optional) */
  state: string | null;

  /** PKCE code challenge (required for public clients) */
  codeChallenge: string | null;

  /** PKCE challenge method (S256 or plain) */
  codeChallengeMethod: "S256" | "plain" | null;

  /** Whether this code has been used (single-use enforcement) */
  isUsed: boolean;

  /** Client ID this code was issued to */
  clientId: string;

  /** User ID who authorized this code */
  userId: string;

  /** Company chosen on the consent screen (null when none was chosen) */
  companyId: string | null;
};

export const oauthAuthorizationCodeMeta: DataMeta = {
  type: "oauth-authorization-codes",
  endpoint: "oauth/authorization-codes",
  nodeName: "oauthauthorizationcode",
  labelName: "OAuthAuthorizationCode",
};
