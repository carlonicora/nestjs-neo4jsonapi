/**
 * OAuth2 Error Codes
 *
 * Standard error codes as defined in RFC 6749 Section 5.2 (Error Response)
 * and RFC 7009 Section 2.2.1 (Token Revocation Error Response).
 *
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-5.2
 */
export const OAuthErrorCodes = {
  /**
   * The request is missing a required parameter, includes an unsupported
   * parameter value, repeats a parameter, includes multiple credentials,
   * or is otherwise malformed.
   */
  INVALID_REQUEST: "invalid_request",

  /**
   * Client authentication failed (unknown client, no client authentication
   * included, or unsupported authentication method).
   */
  INVALID_CLIENT: "invalid_client",

  /**
   * The provided authorization grant or refresh token is invalid, expired,
   * revoked, does not match the redirection URI used in the authorization
   * request, or was issued to another client.
   */
  INVALID_GRANT: "invalid_grant",

  /**
   * The authenticated client is not authorized to use this authorization
   * grant type.
   */
  UNAUTHORIZED_CLIENT: "unauthorized_client",

  /**
   * The authorization grant type is not supported by the authorization server.
   */
  UNSUPPORTED_GRANT_TYPE: "unsupported_grant_type",

  /**
   * The requested scope is invalid, unknown, malformed, or exceeds the
   * scope granted by the resource owner.
   */
  INVALID_SCOPE: "invalid_scope",

  /**
   * The resource owner or authorization server denied the request.
   * Used in authorization endpoint error responses.
   */
  ACCESS_DENIED: "access_denied",

  /**
   * The authorization server does not support obtaining an authorization
   * code using this method. Used when response_type is not 'code'.
   */
  UNSUPPORTED_RESPONSE_TYPE: "unsupported_response_type",

  /**
   * The authorization server encountered an unexpected condition that
   * prevented it from fulfilling the request.
   */
  SERVER_ERROR: "server_error",

  /**
   * The authorization server is currently unable to handle the request
   * due to temporary overloading or maintenance of the server.
   */
  TEMPORARILY_UNAVAILABLE: "temporarily_unavailable",

  /**
   * The value of one of the client metadata fields is invalid (RFC 7591
   * Section 3.2.2, Dynamic Client Registration).
   */
  INVALID_CLIENT_METADATA: "invalid_client_metadata",
} as const;

export type OAuthErrorCode = (typeof OAuthErrorCodes)[keyof typeof OAuthErrorCodes];

/**
 * Human-readable error descriptions for OAuth error codes.
 */
export const OAuthErrorDescriptions: Record<OAuthErrorCode, string> = {
  [OAuthErrorCodes.INVALID_REQUEST]: "The request is missing a required parameter or is otherwise malformed.",
  [OAuthErrorCodes.INVALID_CLIENT]: "Client authentication failed.",
  [OAuthErrorCodes.INVALID_GRANT]: "The provided authorization code or refresh token is invalid or expired.",
  [OAuthErrorCodes.UNAUTHORIZED_CLIENT]: "The client is not authorized to use this grant type.",
  [OAuthErrorCodes.UNSUPPORTED_GRANT_TYPE]: "The grant type is not supported.",
  [OAuthErrorCodes.INVALID_SCOPE]: "The requested scope is invalid or exceeds the allowed scope.",
  [OAuthErrorCodes.ACCESS_DENIED]: "The resource owner denied the request.",
  [OAuthErrorCodes.UNSUPPORTED_RESPONSE_TYPE]: "The response type is not supported.",
  [OAuthErrorCodes.SERVER_ERROR]: "An unexpected error occurred on the authorization server.",
  [OAuthErrorCodes.TEMPORARILY_UNAVAILABLE]: "The authorization server is temporarily unavailable.",
  [OAuthErrorCodes.INVALID_CLIENT_METADATA]: "A client metadata field is invalid.",
};

/**
 * OAuth Error Response interface per RFC 6749 Section 5.2
 */
export interface OAuthErrorResponse {
  error: OAuthErrorCode;
  error_description?: string;
  error_uri?: string;
}

/**
 * Creates a standard OAuth error response object.
 * @param code - OAuth error code
 * @param description - Optional custom description (uses default if not provided)
 * @param uri - Optional URI for more information about the error
 */
export function createOAuthError(code: OAuthErrorCode, description?: string, uri?: string): OAuthErrorResponse {
  return {
    error: code,
    error_description: description ?? OAuthErrorDescriptions[code],
    ...(uri && { error_uri: uri }),
  };
}
