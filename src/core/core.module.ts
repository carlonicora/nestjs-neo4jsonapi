import { DynamicModule, Global, Module, Provider, Type } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AbstractCompanyConfigurations } from "../common";
import { COMPANY_CONFIGURATIONS_FACTORY, CompanyConfigurationsFactory } from "../common/tokens";
import { baseConfig } from "../config/base.config";

// Import all core modules
import { BlockNoteModule } from "./blocknote/blocknote.module";
import { CacheModule } from "./cache/cache.module";
import { CorsModule } from "./cors/cors.module";
import { DebugModule } from "./debug/debug.module";
import { EmailModule } from "./email/email.module";
import { JsonApiModule } from "./jsonapi/jsonapi.module";
import { LLMModule } from "./llm/llm.module";
import { LoggingModule } from "./logging/logging.module";
import { MigratorModule } from "./migrator/migrator.module";
import { Neo4JModule } from "./neo4j/neo4j.module";
import { QueueModule } from "./queue/queue.module";
import { RedisModule } from "./redis/redis.module";
import { SecurityModule } from "./security/security.module";
import { StripeModule } from "./stripe/stripe.module";
import { TracingModule } from "./tracing/tracing.module";
import { VersionModule } from "./version/version.module";
import { WebsocketModule } from "./websocket/websocket.module";

/**
 * Get all core modules to import (some require .forRoot())
 * Modules that have .forRoot() methods and need configuration are called with .forRoot()
 *
 * Order is important:
 * 1. Config-dependent modules with no external connections first
 * 2. External service connections (Redis, Neo4j) second
 * 3. Services using external connections last
 *
 * QueueModule is loaded for ALL modes:
 * - API mode needs it to add jobs to queues (BullModule.registerQueue)
 * - Worker mode needs it to process jobs
 */
function getCoreModules() {
  return [
    // JWT and Passport for authentication
    JwtModule.register({
      secret: baseConfig.jwt.secret,
      signOptions: { expiresIn: baseConfig.jwt.expiresIn as any },
    }),
    PassportModule,
    // 1. Config-dependent but no external connections
    SecurityModule,
    CorsModule.forRoot(),
    VersionModule.forRoot(),
    LoggingModule,
    DebugModule,
    JsonApiModule.forRoot(),
    TracingModule.forRoot(),
    // 2. External service connections (Redis, Neo4j)
    Neo4JModule,
    RedisModule,
    CacheModule,
    // 3. Queue module - needed for both API (add jobs) and Worker (process jobs)
    QueueModule,
    // 4. Services using external connections
    EmailModule.forRoot(),
    StripeModule.forRoot(),
    WebsocketModule,
    LLMModule,
    BlockNoteModule,
    MigratorModule,
  ];
}

/**
 * Get core modules for export
 * QueueModule is exported for ALL modes (API needs it to add jobs)
 */
function getCoreModuleExports() {
  return [
    JwtModule,
    PassportModule,
    Neo4JModule,
    RedisModule,
    CacheModule,
    SecurityModule,
    EmailModule,
    CorsModule,
    VersionModule,
    StripeModule,
    WebsocketModule,
    LLMModule,
    BlockNoteModule,
    DebugModule,
    JsonApiModule,
    TracingModule,
    LoggingModule,
    QueueModule,
  ];
}

/**
 * Options for CoreModule.forRoot()
 */
export interface CoreModuleOptions {
  /**
   * CompanyConfigurations class that extends AbstractCompanyConfigurations.
   * This class will be used to create configuration instances for each request.
   */
  companyConfigurations?: Type<AbstractCompanyConfigurations>;
}

/**
 * CoreModule - Centralized module that provides all core infrastructure
 *
 * All services use `baseConfig` directly - no DI token injection needed.
 *
 * Usage:
 * ```typescript
 * @Module({
 *   imports: [
 *     CoreModule.forRoot({ companyConfigurations: MyCompanyConfigurations }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class CoreModule {
  /**
   * Configure CoreModule with all core infrastructure modules
   */
  static forRoot(options?: CoreModuleOptions): DynamicModule {
    const providers: Provider[] = [];

    // Create factory provider for company configurations
    if (options?.companyConfigurations) {
      const ConfigClass = options.companyConfigurations;
      providers.push({
        provide: COMPANY_CONFIGURATIONS_FACTORY,
        useValue: (async (params) => {
          const config = new ConfigClass({
            companyId: params.companyId,
            userId: params.userId,
            language: params.language,
            roles: params.roles,
          });
          await config.loadConfigurations({ neo4j: params.neo4j });
          return config;
        }) as CompanyConfigurationsFactory,
      });
    } else {
      // Provide null as default so @Optional() works correctly
      providers.push({
        provide: COMPANY_CONFIGURATIONS_FACTORY,
        useValue: null,
      });
    }

    return {
      module: CoreModule,
      imports: getCoreModules(),
      providers,
      exports: [...getCoreModuleExports(), COMPANY_CONFIGURATIONS_FACTORY],
      global: true,
    };
  }
}
