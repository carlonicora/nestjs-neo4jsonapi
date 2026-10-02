import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import {
  OAuth2Scopes,
  OAuthScopeDefinition,
  OAuthScopeDescriptions,
  OAuthScopeNames,
  parseScopes,
} from "../constants/oauth.scopes";

/**
 * OAuth Scope Service
 *
 * The runtime registry of OAuth scopes: the package built-ins followed by the
 * app-specific scopes registered through config (`oauth.additionalScopes`).
 * Every runtime scope check goes through here rather than the built-in-only
 * helpers in `constants/oauth.scopes.ts`.
 */
@Injectable()
export class OAuthScopeService {
  private readonly definitions: OAuthScopeDefinition[];
  private readonly byScope: Map<string, OAuthScopeDefinition>;

  constructor(private readonly configService: ConfigService<BaseConfigInterface>) {
    const builtIns: OAuthScopeDefinition[] = Object.values(OAuth2Scopes).map((scope) => ({
      scope,
      name: OAuthScopeNames[scope],
      description: OAuthScopeDescriptions[scope],
    }));
    const additional = this.configService.get("oauth", { infer: true })?.additionalScopes ?? [];

    this.definitions = [...builtIns, ...additional];
    this.byScope = new Map();
    for (const definition of this.definitions) {
      if (this.byScope.has(definition.scope)) {
        throw new Error(`Duplicate OAuth scope "${definition.scope}" in oauth.additionalScopes`);
      }
      this.byScope.set(definition.scope, definition);
    }
  }

  /** All registered scopes: built-ins first, then config additional scopes. */
  all(): OAuthScopeDefinition[] {
    return [...this.definitions];
  }

  /** True when the scope is a built-in or a registered additional scope. */
  isValid(scope: string): boolean {
    return this.byScope.has(scope);
  }

  /**
   * Validates that every requested scope is registered.
   * @param scopes - Space-separated scope string or array of scopes
   */
  validate(scopes: string | string[]): boolean {
    const scopeArray = Array.isArray(scopes) ? scopes : parseScopes(scopes);
    return scopeArray.every((scope) => this.isValid(scope));
  }

  /** Consent-screen label and description for a scope; falls back for unknown scopes. */
  describe(scope: string): { name: string; description: string } {
    const definition = this.byScope.get(scope);
    if (!definition) return { name: scope, description: `Access to ${scope}` };
    return { name: definition.name, description: definition.description };
  }
}
