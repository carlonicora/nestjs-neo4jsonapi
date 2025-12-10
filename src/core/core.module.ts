import { DynamicModule, Global, Module, Provider } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { BaseConfigInterface, ConfigJwtInterface } from "../config/interfaces";

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
 *
 * @param queueIds - Additional queue IDs to register (library's CHUNK queue is always included)
 */
function getCoreModules(queueIds: string[] = []) {
  return [
    // JWT and Passport for authentication - uses ConfigService async
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<BaseConfigInterface>) => {
        const jwt = configService.get<ConfigJwtInterface>("jwt");
        return {
          secret: jwt?.secret,
          signOptions: { expiresIn: jwt?.expiresIn as any },
        };
      },
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
    // 3. Queue module - uses ConfigService for Redis, explicit queue IDs for registration
    QueueModule.forRootWithQueues(queueIds),
    // 4. Services using external connections
    EmailModule.forRoot(),
    StripeModule.forRoot(),
    WebsocketModule,
    LLMModule,
    BlockNoteModule,
    MigratorModule,
    VersionModule,
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
    VersionModule,
  ];
}

/**
 * Options for CoreModule.forRoot()
 */
export interface CoreModuleOptions {
  /**
   * Queue IDs to register with BullMQ.
   * The library's CHUNK queue is always registered automatically.
   * Pass additional queue IDs here for app-specific queues.
   */
  queueIds?: string[];
}

/**
 * CoreModule - Centralized module that provides all core infrastructure
 *
 * All services use ConfigService for configuration - no static baseConfig usage.
 *
 * Usage:
 * ```typescript
 * @Module({
 *   imports: [
 *     CoreModule.forRoot({
 *       queueIds: ['my-queue-1', 'my-queue-2'],
 *     }),
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

    return {
      module: CoreModule,
      imports: getCoreModules(options?.queueIds ?? []),
      providers,
      exports: [...getCoreModuleExports()],
      global: true,
    };
  }
}
