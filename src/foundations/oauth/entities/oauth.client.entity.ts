import { Entity } from "../../../common/abstracts/entity";
import { Company } from "../../company/entities/company";
import { User } from "../../user/entities/user";

/**
 * OAuth Client Entity
 *
 * Represents a registered OAuth2 application that can request
 * authorization to access user resources.
 */
export type OAuthClient = Entity & {
  /** Unique public identifier for the client (UUID) */
  clientId: string;

  /** Bcrypt hash of the client secret (null for public clients) */
  clientSecretHash: string | null;

  /** Human-readable application name */
  name: string;

  /** Optional application description */
  description: string | null;

  /** Allowed redirect URIs (must match exactly during authorization) */
  redirectUris: string[];

  /** Scopes this client is allowed to request */
  allowedScopes: string[];

  /** Grant types this client can use */
  allowedGrantTypes: string[];

  /** True for server-side apps that can keep secrets, false for mobile/desktop */
  isConfidential: boolean;

  /** Whether the client is active and can be used */
  isActive: boolean;

  /** Custom access token lifetime in seconds (overrides default) */
  accessTokenLifetime: number;

  /** Custom refresh token lifetime in seconds (overrides default) */
  refreshTokenLifetime: number;

  /** User who created/owns this client */
  owner?: User;

  /** Company this client belongs to */
  company?: Company;
};
