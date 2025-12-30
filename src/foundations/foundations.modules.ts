import { DynamicModule, Module } from "@nestjs/common";
import { AtomicFactModule } from "./atomicfact/atomicfact.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { ChunkModule } from "./chunk/chunk.module";
import { ChunkerModule } from "./chunker/chunker.module";
import { CompanyModule } from "./company/company.module";
import { ContentModule } from "./content/content.module";
import { ContentExtensionConfig } from "./content/interfaces/content.extension.interface";
import { DiscordUserModule } from "./discord-user/discord-user.module";
import { FeatureModule } from "./feature/feature.module";
import { KeyConceptModule } from "./keyconcept/keyconcept.module";
import { ModuleModule } from "./module/module.module";
import { NotificationModule } from "./notification/notification.module";
import { PushModule } from "./push/push.module";
import { RelevancyModule } from "./relevancy/relevancy.module";
import { RoleModule } from "./role/role.module";
import { S3Module } from "./s3/s3.module";
import { StripeInvoiceModule } from "./stripe-invoice/stripe-invoice.module";
import { StripePriceModule } from "./stripe-price";
import { StripeProductModule } from "./stripe-product";
import { StripeSubscriptionModule } from "./stripe-subscription";
import { StripeModule } from "./stripe/stripe.module";
import { TokenUsageModule } from "./tokenusage/tokenusage.module";
import { UserModule } from "./user/user.module";

/**
 * Configuration options for FoundationsModule.
 */
export interface FoundationsModuleConfig {
  /** Optional extension for Content module to add additional relationships */
  contentExtension?: ContentExtensionConfig;
}

/**
 * All static foundation modules (excluding ContentModule which is dynamic).
 * Queue registration is handled centrally by QueueModule (via baseConfig.chunkQueues).
 */
const STATIC_FOUNDATION_MODULES = [
  AtomicFactModule,
  AuditModule,
  AuthModule,
  ChunkModule,
  ChunkerModule,
  CompanyModule,
  DiscordUserModule,
  FeatureModule,
  KeyConceptModule,
  ModuleModule,
  NotificationModule,
  PushModule,
  RelevancyModule,
  RoleModule,
  S3Module,
  TokenUsageModule,
  UserModule,
  StripeModule,
  StripeSubscriptionModule,
  StripePriceModule,
  StripeProductModule,
  StripeInvoiceModule,
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
    return {
      module: FoundationsModule,
      imports: [...STATIC_FOUNDATION_MODULES, ContentModule.forRoot(config?.contentExtension)],
      exports: [...STATIC_FOUNDATION_MODULES, ContentModule],
    };
  }
}
