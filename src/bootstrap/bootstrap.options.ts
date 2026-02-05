import { DynamicModule, Type } from "@nestjs/common";
import { EntityDescriptor, RelationshipDef } from "../common/interfaces/entity.schema.interface";
import { ContentExtensionConfig } from "../foundations/content/interfaces/content.extension.interface";
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
