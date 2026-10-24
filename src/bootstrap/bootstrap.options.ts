import { DynamicModule, Type } from "@nestjs/common";
import { EntityDescriptor, RelationshipDef } from "../common/interfaces/entity.schema.interface";
import { AiSourceQueryProvider } from "../common/repositories/ai-source-query.provider";
import { SecurityService } from "../core/security/services/security.service";
import { ContentExtensionConfig } from "../foundations/content/interfaces/content.extension.interface";
import type { RbacMatrix } from "../foundations/rbac/dsl/types";
import { ReferralModuleConfig } from "../foundations/referral/interfaces/referral.config.interface";
import { HandbookModuleConfig } from "../foundations/handbook/interfaces/handbook.config.interface";
import { HowToModuleConfig } from "../foundations/how-to/interfaces/how-to.config.interface";
import { BlogModuleConfig } from "../foundations/blog/interfaces/blog.config.interface";
import { BillingModuleConfig } from "../foundations/billing/interfaces/billing.config.interface";
import { EmailAutomationModuleConfig } from "../foundations/email-automation/interfaces/email-automation.config.interface";
import { UserActivityModuleConfig } from "../foundations/user-activity/interfaces/user-activity.config.interface";
import { AnalyticsModuleConfig } from "../foundations/analytics/interfaces/analytics.config.interface";

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
   * Configuration for the user-activity feature module.
   * Controls the queue/job used to record activity and whether the global
   * recording interceptor is installed. Omitted keys fall back to the module
   * defaults (queue "user-activity", job "userActivity:record", interceptor off).
   *
   * @example
   * ```typescript
   * userActivity: {
   *   queueId: QueueId.USER_ACTIVITY,
   *   jobName: JobName.userActivity.Record,
   *   interceptorEnabled: true,
   * }
   * ```
   */
  userActivity?: UserActivityModuleConfig;

  /**
   * Configuration for the handbook documentation RAG foundation.
   * Forwarded to `FoundationsModule.forRoot({ handbook })`, exactly like
   * `contentExtension` / `referral` / `userActivity` above — without this seam
   * a consuming app has no way to tell `HandbookModule` where its docs live,
   * and the foundation stays inert on the empty default path.
   *
   * @example
   * ```typescript
   * handbook: { path: "docs/handbook", exclude: ["it/**"] }
   * ```
   */
  handbook?: HandbookModuleConfig;

  /**
   * Configuration for the how-to feature module.
   * Forwarded to `FoundationsModule.forRoot({ howTo })`, exactly like
   * `contentExtension` / `referral` / `userActivity` / `handbook` above —
   * without this seam a consuming app has no way to switch on
   * `HowToPublicController`, and the three unauthenticated `public/howtos/*`
   * routes stay off for everyone.
   *
   * Omitted is fail-closed: the how-to foundation mounts its authenticated
   * controller only. Set `publicRoutes` deliberately, and only where serving a
   * public knowledge base is intended — the read filter is
   * `draft IS NULL OR draft = false`, so a guide with no `draft` property is
   * served.
   *
   * @example
   * ```typescript
   * howTo: { publicRoutes: true }
   * ```
   */
  howTo?: HowToModuleConfig;

  /**
   * Configuration for the blog feature module.
   * Forwarded to `FoundationsModule.forRoot({ blog })`. OPT-IN: omitted, the
   * blog is not mounted at all (no controllers, queue or worker, and no Blog
   * permission section to seed). `{}` mounts the authenticated admin
   * controllers; `publicRoutes: true` also adds the unauthenticated
   * `public/blog-*` reads, which serve published posts only.
   *
   * @example
   * ```typescript
   * blog: { publicRoutes: true }
   * ```
   */
  blog?: BlogModuleConfig;

  /**
   * Configuration for the email-automation feature module.
   * Forwarded to `FoundationsModule.forRoot({ emailAutomation })`, exactly like
   * `contentExtension` / `referral` / `userActivity` / `handbook` / `howTo` above —
   * without this seam a consuming app has no way to declare the triggers that
   * enrol people into an automation.
   *
   * Omitted is inert: the admin and unsubscribe routes are mounted, but with no
   * triggers nobody is ever enrolled. The library declares no trigger key; the
   * app picks every key and label.
   *
   * @example
   * ```typescript
   * emailAutomation: {
   *   triggers: [waitlistConfirmedTrigger("waitlist-confirmed"), userActivatedTrigger("registration-completed")],
   * }
   * ```
   */
  emailAutomation?: EmailAutomationModuleConfig;

  /**
   * Configuration for the billing module.
   * Forwarded to `FoundationsModule.forRoot({ billing })`, exactly like
   * `emailAutomation` above. The module is always mounted; every key is optional.
   *
   * Omitted keeps the defaults: failed-card grace on, the library
   * billing email sender off (apps that consume `QueueId.EMAIL` with their own
   * processor keep it), every billing email on, deletion 30 days after a
   * subscription ends.
   *
   * @example
   * ```typescript
   * billing: {
   *   emailSender: { enabled: true },
   *   deletion: { afterSubscriptionEndedDays: 365 },
   * }
   * ```
   */
  billing?: BillingModuleConfig;

  /**
   * Configuration for the first-party web analytics feature module.
   * Forwarded to `FoundationsModule.forRoot({ analytics })`, exactly like
   * `userActivity` / `howTo` above.
   *
   * The normal way to switch analytics on is the environment:
   * `ANALYTICS_ENABLED=true`, with optional `ANALYTICS_RETENTION_MONTHS` and
   * `ANALYTICS_SESSION_TIMEOUT_MINUTES`. This option is an override: keys set
   * here win over the environment. With the variable unset and no override the
   * module registers no controller, no queue, no processor and no retention
   * cron. Keys set nowhere fall back to the module defaults (retention 13
   * months, session timeout 30 minutes, queue "analytics", job
   * "analytics:pageView").
   *
   * @example
   * ```typescript
   * // Force analytics off whatever ANALYTICS_ENABLED says
   * analytics: { enabled: false }
   * ```
   */
  analytics?: AnalyticsModuleConfig;

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
   * Request-level permission gate. Default undefined = off: no new query, no
   * new refusal, no new reconcile writes.
   *
   * With `enforce: true`:
   * - every request that passes `JwtAuthGuard`, `AdminJwtAuthGuard` or
   *   `OptionalJwtAuthGuard` (with a user) is checked against the section its
   *   controller/handler declares with `@ModuleACL({ module })` and the action
   *   of its HTTP method (or `@ModuleACL({ action })`); a refusal is 403;
   * - permissions resolve in the token's company only (plus platform
   *   memberships); a record-path value allows at the section level;
   * - there is no administrator bypass, and `RbacReconcilerService` writes the
   *   Administrator's grants from the matrix like any other role's;
   * - the boot audit refuses to start when a session-guarded write route has
   *   no section, or a referenced section has no `(:Module)` node.
   */
  permissions?: { enforce: boolean };

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

  /** When true, mounts the MCP (Model Context Protocol) server module at POST /mcp. Default false. */
  mcp?: boolean;

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
