/**
 * OAuth Module Public API
 *
 * Exports all public interfaces, services, guards, and decorators
 * for OAuth2 functionality.
 */

// Module
export { OAuthModule } from "./oauth.module";

// Services
export { OAuthService } from "./services/oauth.service";
export { OAuthClientService } from "./services/oauth.client.service";
export { OAuthTokenService } from "./services/oauth.token.service";
export { OAuthPkceService } from "./services/oauth.pkce.service";

// Guards
export { OAuthTokenGuard } from "./guards/oauth.token.guard";

// Constants
export { OAuth2Scopes, VALID_OAUTH_SCOPES } from "./constants/oauth.scopes";
export type { OAuthScopeType } from "./constants/oauth.scopes";
export { OAuthErrorCodes, createOAuthError } from "./constants/oauth.errors";
export type { OAuthErrorCode } from "./constants/oauth.errors";

// Entities
export type { OAuthClient } from "./entities/oauth.client.entity";
export { oauthClientMeta } from "./entities/oauth.client.meta";
export type { OAuthAccessToken } from "./entities/oauth.access.token.entity";
export { oauthAccessTokenMeta } from "./entities/oauth.access.token.entity";
export type { OAuthRefreshToken } from "./entities/oauth.refresh.token.entity";
export { oauthRefreshTokenMeta } from "./entities/oauth.refresh.token.entity";

// Models
export { OAuthClientModel } from "./entities/oauth.client.model";
export { OAuthAccessTokenModel } from "./entities/oauth.access.token.model";
export { OAuthRefreshTokenModel } from "./entities/oauth.refresh.token.model";

// DTOs
export { OAuthAuthorizeQueryDto } from "./dtos/oauth.authorize.dto";
export { OAuthTokenRequestDto, OAuthTokenResponseDto } from "./dtos/oauth.token.dto";
export { OAuthRevokeRequestDto } from "./dtos/oauth.revoke.dto";
export { OAuthIntrospectRequestDto, OAuthIntrospectResponseDto } from "./dtos/oauth.introspect.dto";
export { OAuthClientCreateDto, OAuthClientUpdateDto } from "./dtos/oauth.client.dto";
export { OAuthRegisterDto } from "./dtos/oauth.register.dto";

// Serializers
export { OAuthClientSerialiser } from "./serialisers/oauth.client.serialiser";
export { OAuthTokenSerialiser } from "./serialisers/oauth.token.serialiser";

// Service interfaces (for dependency injection)
export type { CreateClientParams, UpdateClientParams } from "./services/oauth.client.service";
export type {
  GenerateAccessTokenParams,
  GenerateRefreshTokenParams,
  AccessTokenValidationResult,
  RefreshTokenValidationResult,
} from "./services/oauth.token.service";
export type {
  AuthorizeParams,
  TokenCodeParams,
  ClientCredentialsParams,
  RefreshTokenParams,
  TokenResponse,
  RevokeParams,
  IntrospectParams,
} from "./services/oauth.service";
