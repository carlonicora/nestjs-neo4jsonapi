import { Module, OnModuleInit } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { modelRegistry } from "../../common/registries/registry";

// Controllers
import { OAuthAuthorizeController } from "./controllers/oauth.authorize.controller";
import { OAuthTokenController } from "./controllers/oauth.token.controller";
import { OAuthManagementController } from "./controllers/oauth.management.controller";
import { OAuthRegistrationController } from "./controllers/oauth.registration.controller";
import { OAuthDiscoveryController } from "./controllers/oauth.discovery.controller";

// Services
import { OAuthService } from "./services/oauth.service";
import { OAuthClientService } from "./services/oauth.client.service";
import { OAuthTokenService } from "./services/oauth.token.service";
import { OAuthPkceService } from "./services/oauth.pkce.service";
import { OAuthScopeService } from "./services/oauth.scope.service";

// Repository
import { OAuthRepository } from "./repositories/oauth.repository";

// Serializers
import { OAuthClientSerialiser } from "./serialisers/oauth.client.serialiser";
import { OAuthTokenSerialiser } from "./serialisers/oauth.token.serialiser";

// Models
import { OAuthClientModel } from "./entities/oauth.client.model";
import { OAuthAccessTokenModel } from "./entities/oauth.access.token.model";
import { OAuthRefreshTokenModel } from "./entities/oauth.refresh.token.model";

/**
 * OAuth Module
 *
 * Provides OAuth2 Authorization Server functionality.
 * Implements RFC 6749 (OAuth 2.0), RFC 7636 (PKCE),
 * RFC 7009 (Token Revocation), RFC 7662 (Token Introspection),
 * RFC 7591 (Dynamic Client Registration), RFC 8414 (Authorization
 * Server Metadata), and RFC 9728 (Protected Resource Metadata).
 *
 * @example
 * // In your app module
 * imports: [OAuthModule]
 *
 * // Protect endpoints with OAuth
 * @UseGuards(OAuthTokenGuard)
 * @OAuthScopes('read')
 * async getDocuments() { ... }
 */
@Module({
  controllers: [
    OAuthAuthorizeController,
    OAuthTokenController,
    OAuthManagementController,
    OAuthRegistrationController,
    OAuthDiscoveryController,
  ],
  providers: [
    // Services
    OAuthService,
    OAuthClientService,
    OAuthTokenService,
    OAuthPkceService,
    OAuthScopeService,

    // Repository
    OAuthRepository,

    // Serializers
    OAuthClientSerialiser,
    OAuthTokenSerialiser,
  ],
  exports: [
    // Export services for use by other modules
    OAuthService,
    OAuthClientService,
    OAuthTokenService,
    OAuthPkceService,
    OAuthScopeService,

    // Export serializers
    OAuthClientSerialiser,
    OAuthTokenSerialiser,
  ],
  // No UserModule / CompanyModule import: OAuth uses no provider from either
  // (only their entity types and metas), and importing them mounts the package
  // UserController / CompanyController. An app that replaces those foundations
  // with its own controllers (a360ai's Extended* modules) then crashes at boot
  // with FST_ERR_DUPLICATED_ROUTE on GET /users.
  imports: [JwtModule],
})
export class OAuthModule implements OnModuleInit {
  /**
   * Register OAuth models in the model registry.
   * This enables JSON:API serialization for OAuth entities.
   */
  onModuleInit() {
    modelRegistry.register(OAuthClientModel);
    modelRegistry.register(OAuthAccessTokenModel);
    modelRegistry.register(OAuthRefreshTokenModel);
  }
}
