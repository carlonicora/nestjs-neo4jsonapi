import { DynamicModule, Module, Type } from "@nestjs/common";
import { AccountDeletionModule } from "./account-deletion/account-deletion.module";
import { AccountDeletionModuleConfig } from "./account-deletion/account-deletion.config";
import { AiConnectionModule } from "./ai-connection/ai-connection.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AnalyticsModuleConfig } from "./analytics/interfaces/analytics.config.interface";
import { AssistantModule } from "./assistant/assistant.module";
import { AtomicFactModule } from "./atomicfact/atomicfact.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { BillingModuleConfig } from "./billing/interfaces/billing.config.interface";
import { BlogModule } from "./blog/blog.module";
import { BlogModuleConfig } from "./blog/interfaces/blog.config.interface";
import { ChunkModule } from "./chunk/chunk.module";
import { ChunkerModule } from "./chunker/chunker.module";
import { CompanyModule } from "./company/company.module";
import { ContentModule } from "./content/content.module";
import { ContentExtensionConfig } from "./content/interfaces/content.extension.interface";
import { ReferralModule } from "./referral/referral.module";
import { ReferralModuleConfig } from "./referral/interfaces/referral.config.interface";
import { DiscordUserModule } from "./discord-user/discord-user.module";
import { EmailAutomationModule } from "./email-automation/email-automation.module";
import { EmailAutomationModuleConfig } from "./email-automation/interfaces/email-automation.config.interface";
import { FeatureModule } from "./feature/feature.module";
import { HandbookModule } from "./handbook/handbook.module";
import { HandbookModuleConfig } from "./handbook/interfaces/handbook.config.interface";
import { HowToModule } from "./how-to/how-to.module";
import { HowToModuleConfig } from "./how-to/interfaces/how-to.config.interface";
import { KeyConceptModule } from "./keyconcept/keyconcept.module";
import { MembershipModule } from "./membership/membership.module";
import { ModuleModule } from "./module/module.module";
import { NotificationModule } from "./notification/notification.module";
import { OAuthModule } from "./oauth/oauth.module";
import { PushModule } from "./push/push.module";
import { RelevancyModule } from "./relevancy/relevancy.module";
import { RoleModule } from "./role/role.module";
import { S3Module } from "./s3/s3.module";
import { StripeCustomerModule } from "./stripe-customer/stripe-customer.module";
import { StripeInvoiceModule } from "./stripe-invoice/stripe-invoice.module";
import { StripePriceModule } from "./stripe-price";
import { StripeProductModule } from "./stripe-product";
import { StripeCouponModule } from "./stripe-coupon/stripe-coupon.module";
import { StripePromotionCodeModule } from "./stripe-promotion-code";
import { StripeSubscriptionModule } from "./stripe-subscription";
import { StripeUsageModule } from "./stripe-usage/stripe-usage.module";
import { StripeWebhookModule } from "./stripe-webhook/stripe-webhook.module";
import { StripeModule } from "./stripe/stripe.module";
import { StripeTrialModule } from "./stripe-trial/stripe-trial.module";
import { TokenUsageModule } from "./tokenusage/tokenusage.module";
import { TwoFactorModule } from "./two-factor/two-factor.module";
import { ResponseLanguageModule } from "./user/response-language.module";
import { UserModule } from "./user/user.module";
import { UserActivityModule } from "./user-activity/user-activity.module";
import { UserActivityModuleConfig } from "./user-activity/interfaces/user-activity.config.interface";
import { WaitlistModule } from "./waitlist/waitlist.module";

/**
 * Configuration options for FoundationsModule.
 */
export interface FoundationsModuleConfig {
  /** Optional extension for Content module to add additional relationships */
  contentExtension?: ContentExtensionConfig;
  /** Optional configuration for the referral feature module */
  referral?: ReferralModuleConfig;
  /** Optional configuration for the user-activity feature module */
  userActivity?: UserActivityModuleConfig;
  /** Optional configuration for the handbook documentation RAG */
  handbook?: HandbookModuleConfig;
  /** Optional configuration for the how-to feature module (opt-in public routes) */
  howTo?: HowToModuleConfig;
  /**
   * The blog feature module. OPT-IN: the blog mounts only when this key is
   * present (`blog: {}` for the admin routes, `blog: { publicRoutes: true }`
   * for the public reads too). Omitted, no blog controller, queue or worker is
   * mounted, so an app with the permission gate on needs no Blog section seed.
   */
  blog?: BlogModuleConfig;
  /**
   * Self-service account deletion with a grace period. OPT-IN: mounted only
   * when this key is present (`accountDeletion: {}` for the 7-day default).
   * Omitted, no route, cron, queue, processor or login hook exists.
   */
  accountDeletion?: AccountDeletionModuleConfig;
  /** Optional configuration for the email-automation feature module (the triggers the app declares) */
  emailAutomation?: EmailAutomationModuleConfig;
  /** Optional override for the analytics feature module (normally switched on by `ANALYTICS_ENABLED=true`) */
  analytics?: AnalyticsModuleConfig;
  /** Optional configuration for the billing module (settings, lifecycle cron, opt-in email sender) */
  billing?: BillingModuleConfig;
  /**
   * Foundation module classes to exclude from registration.
   * Default [] keeps all modules registered (neural-erp behavior unchanged).
   *
   * Dynamic modules are excluded by the same class reference as static ones:
   * `exclude: [ContentModule, UserActivityModule]`.
   */
  exclude?: Type<any>[];
}

/**
 * All static foundation modules. The dynamic ones (ContentModule,
 * UserActivityModule, ReferralModule, HandbookModule, HowToModule, BlogModule (opt-in), EmailAutomationModule,
 * AnalyticsModule, BillingModule) are
 * assembled inside forRoot().
 *
 * HowToModule is dynamic solely so an app can reach
 * `forRoot({ publicRoutes: true })` through `config.howTo`: with no `howTo`
 * config it registers the authenticated controller alone, exactly as it did
 * when it was listed here.
 * Queue registration is handled centrally by QueueModule (via baseConfig.chunkQueues).
 */
const STATIC_FOUNDATION_MODULES = [
  AiConnectionModule,
  AssistantModule,
  AtomicFactModule,
  AuditModule,
  AuthModule,
  ChunkModule,
  ChunkerModule,
  CompanyModule,
  DiscordUserModule,
  FeatureModule,
  KeyConceptModule,
  MembershipModule,
  ModuleModule,
  NotificationModule,
  OAuthModule,
  PushModule,
  RelevancyModule,
  RoleModule,
  S3Module,
  TokenUsageModule,
  TwoFactorModule,
  UserModule,
  ResponseLanguageModule,
  WaitlistModule,
  StripeModule,
  // Every other stripe-* foundation was registered here; this one was omitted,
  // so its controller (GET/POST/PUT/DELETE /stripe-customers plus all
  // payment-methods routes) was never mounted and its two models were never
  // added to modelRegistry. only35 masks the bug by importing
  // StripeCustomerModule from its own company-deletion module, which mounts the
  // controller as a side effect; consumers without such a module get a 404 on
  // the billing dashboard's very first request.
  StripeCustomerModule,
  StripePromotionCodeModule,
  StripeSubscriptionModule,
  StripePriceModule,
  StripeProductModule,
  StripeCouponModule,
  StripeInvoiceModule,
  StripeUsageModule,
  StripeWebhookModule,
  StripeTrialModule,
];

/**
 * FoundationsModule - Centralized module for all foundation/domain modules
 *
 * Foundation modules provide business domain logic:
 * - User management (UserModule)
 * - Company management (CompanyModule)
 * - Authentication (AuthModule)
 * - Content & document processing (ContentModule, ChunkModule, ChunkerModule)
 * - Knowledge graph entities (AtomicFactModule, KeyConceptModule)
 * - Notifications (NotificationModule, PushModule)
 * - And more...
 *
 * @example
 * ```typescript
 * // Without content extension
 * FoundationsModule.forRoot()
 *
 * // With content extension
 * FoundationsModule.forRoot({
 *   contentExtension: {
 *     additionalRelationships: [
 *       { model: topicMeta, relationship: 'HAS_KNOWLEDGE', direction: 'in', cardinality: 'many' },
 *     ],
 *   },
 * })
 * ```
 */
@Module({})
export class FoundationsModule {
  /**
   * Configure FoundationsModule with optional extensions.
   *
   * @param config - Optional configuration for foundation modules
   * @returns DynamicModule with all foundation modules configured
   */
  static forRoot(config?: FoundationsModuleConfig): DynamicModule {
    const excluded = new Set<Type<any>>(config?.exclude ?? []);
    const modules = STATIC_FOUNDATION_MODULES.filter((m) => !excluded.has(m));

    // Dynamic foundation modules are excluded by class reference exactly like
    // the static ones: the pair keeps the class (matched against `exclude`)
    // next to the factory that configures it, and the factory only runs for
    // modules that survive the filter.
    const dynamicModules: Array<{ classRef: Type<any>; factory: () => DynamicModule }> = [
      { classRef: ContentModule, factory: () => ContentModule.forRoot(config?.contentExtension) },
      { classRef: UserActivityModule, factory: () => UserActivityModule.forRoot(config?.userActivity) },
      { classRef: ReferralModule, factory: () => ReferralModule.forRoot(config?.referral) },
      { classRef: HandbookModule, factory: () => HandbookModule.forRoot(config?.handbook) },
      { classRef: HowToModule, factory: () => HowToModule.forRoot(config?.howTo) },
      {
        classRef: EmailAutomationModule,
        factory: () => EmailAutomationModule.forRoot(config?.emailAutomation),
      },
      { classRef: AnalyticsModule, factory: () => AnalyticsModule.forRoot(config?.analytics) },
      { classRef: BillingModule, factory: () => BillingModule.forRoot(config?.billing) },
      // Opt-in: mounted only when the app passes a `blog` config.
      ...(config?.blog ? [{ classRef: BlogModule, factory: () => BlogModule.forRoot(config.blog) }] : []),
      // Opt-in: mounted only when the app passes an `accountDeletion` config.
      ...(config?.accountDeletion
        ? [{ classRef: AccountDeletionModule, factory: () => AccountDeletionModule.forRoot(config.accountDeletion) }]
        : []),
    ].filter((entry) => !excluded.has(entry.classRef));

    return {
      module: FoundationsModule,
      imports: [...modules, ...dynamicModules.map((entry) => entry.factory())],
      exports: [...modules, ...dynamicModules.map((entry) => entry.classRef)],
    };
  }
}
