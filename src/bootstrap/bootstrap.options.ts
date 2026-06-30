import { DynamicModule, Type } from "@nestjs/common";
import { EntityDescriptor, RelationshipDef } from "../common/interfaces/entity.schema.interface";
import { AiSourceQueryProvider } from "../common/repositories/ai-source-query.provider";
import { SecurityService } from "../core/security/services/security.service";
import { ContentExtensionConfig } from "../foundations/content/interfaces/content.extension.interface";
import type { RbacMatrix } from "../foundations/rbac/dsl/types";
import { ReferralModuleConfig } from "../foundations/referral/interfaces/referral.config.interface";

/**
 * i18n configuration options
 */
export interface I18nOptions {
  /**
   * Fallback language when translation is not available
   * @default "en"
   */
  fallbackLanguage?: string;

  /**
   * Path to the i18n translation files (relative to process.cwd() or absolute)
   * @default "./i18n"
   */
  path?: string;
}

/**
 * Options for the bootstrap function
 *
 * This interface defines all the configuration needed to bootstrap
 * a NestJS application with the library's infrastructure.
 */
export interface BootstrapOptions {
  /**
   * App-specific feature modules to import.
   * These are your application's domain modules.
   */
  appModules: (Type<any> | DynamicModule)[];

  /**
   * i18n configuration for internationalization.
   * If not provided, defaults to English with "./i18n" path.
   */
  i18n?: I18nOptions;

  /**
   * Custom configuration loader that extends baseConfig.
   * Return an object that will be merged with the library's baseConfig.
   */
  config?: () => Record<string, any>;

  /**
   * Optional extension for Content module to add additional relationships.
   * When provided, Content queries and serialization will include the
   * specified relationships.
   *
   * @example
   * ```typescript
   * contentExtension: {
   *   additionalRelationships: [
   *     { model: topicMeta, relationship: 'HAS_KNOWLEDGE', direction: 'in', cardinality: 'many', dtoKey: 'topics' },
   *   ],
   * }
   * ```
   */
  contentExtension?: ContentExtensionConfig;

  /**
   * Configuration for the referral feature module.
   * When provided, enables referral tracking and rewards.
   * Uses APP_URL environment variable for referral links.
   *
   * @example
   * ```typescript
   * referral: {
   *   enabled: true,
   *   rewardTokens: 1000,
   * }
   * ```
   */
  referral?: ReferralModuleConfig;

  /**
   * OpenAPI documentation configuration.
   * When provided, sets up Swagger UI and/or Redoc documentation endpoints.
   *
   * @example
   * ```typescript
   * openApi: {
   *   enableSwagger: true,
   *   swaggerPath: '/api-docs',
   *   enableRedoc: true,
   *   redocPath: '/docs',
   *   title: 'My API',
   *   version: '1.0.0',
   * }
   * ```
   */
  openApi?: OpenApiOptions;

  /**
   * Declarative RBAC matrix.
   * When provided, the RbacReconciler reconciles Neo4j to match this matrix
   * on application bootstrap. See docs for `defineRbac()`.
   */
  rbac?: RbacMatrix;

  /**
   * Optional custom SecurityService subclass to inject into the package engine.
   * The subclass must extend the package SecurityService.
   * Default undefined uses the base SecurityService (neural-erp behavior unchanged).
   */
  securityService?: Type<SecurityService>;
  /** Optional app source-scoping provider for AI retrieval (chunk/atomicfact/keyconcept). */
  aiSourceQuery?: Type<AiSourceQueryProvider>;
  /** Set false to skip the library Neo4j migrator (app provides its own). Default true. */
  migrator?: boolean;

  /**
   * Configuration for foundation module exclusions.
   * Default undefined keeps all foundation modules registered.
   */
  foundations?: {
    /**
     * Foundation module classes to exclude from registration.
     * Default [] keeps all modules registered (neural-erp behavior unchanged).
     */
    exclude?: Type<any>[];
    /**
     * Set true to skip the library FoundationsModule entirely (app provides all its own
     * foundations). Avoids transitive controller collisions. Default false.
     */
    disabled?: boolean;
  };

  /**
   * Set false to skip the library AgentsModule (app provides its own AI). Default true.
   */
  agents?: boolean;

  /**
   * Worker mode configuration.
   * Default undefined — no health server started (neural-erp behavior unchanged).
   */
  worker?: {
    /**
     * Port for the worker health-check HTTP server.
     * When set, a minimal HTTP server responds with { status: "ok" } on this port.
     */
    healthCheckPort?: number;
  };

  /**
   * Security headers configuration for API mode.
   * Default undefined — no helmet registered (neural-erp behavior unchanged).
   */
  security?: {
    /**
     * @fastify/helmet options object.
     * When set, helmet is registered in API mode with these options.
     * Pass `false` to explicitly disable (same as omitting).
     */
    helmet?: Record<string, any> | false;
  };
}

/**
 * OpenAPI documentation options
 */
export interface OpenApiOptions {
  /** Enable Swagger UI endpoint (default: false) */
  enableSwagger?: boolean;
  /** Path for Swagger UI (default: '/api-docs') */
  swaggerPath?: string;
  /** Enable Redoc endpoint (default: false) */
  enableRedoc?: boolean;
  /** Path for Redoc (default: '/docs') */
  redocPath?: string;
  /** API documentation title */
  title?: string;
  /** API documentation description */
  description?: string;
  /** API version */
  version?: string;
  /** Enable JWT Bearer authentication in docs (default: true) */
  bearerAuth?: boolean;
  /** Contact email for API */
  contactEmail?: string;
  /** License name */
  license?: string;
  /** License URL */
  licenseUrl?: string;
  /** Entity descriptors to register for OpenAPI schema generation */
  entityDescriptors?: EntityDescriptor<any, Record<string, RelationshipDef>>[];
}
