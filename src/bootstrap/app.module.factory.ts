import { DynamicModule, Module, Type } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { ClsModule } from "nestjs-cls";
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from "nestjs-i18n";
import * as path from "path";

import { AppModeConfig } from "../core/appmode/constants/app.mode.constant";
import { AppModeModule } from "../core/appmode/app.mode.module";
import { CoreModule } from "../core/core.module";
import { FoundationsModule } from "../foundations/foundations.modules";
import { AgentsModule } from "../agents/agents.modules";
import { baseConfig, BaseConfigInterface, ConfigRateLimitInterface } from "../config";
import { BootstrapOptions } from "./bootstrap.options";

/**
 * Creates a dynamic AppModule based on bootstrap options.
 *
 * This factory generates a fully configured NestJS module with:
 * - Event emitter for async events
 * - App mode configuration (API vs Worker)
 * - Global configuration module
 * - Rate limiting via Throttler
 * - Request context via CLS
 * - i18n internationalization
 * - Schedule module for cron jobs (Worker mode only)
 * - Library's CoreModule, FoundationsModule, and AgentsModule
 * - User's app-specific modules
 *
 * @param options - Bootstrap configuration options
 * @returns A dynamically configured module class
 */
export function createAppModule(options: BootstrapOptions): Type<any> {
  @Module({})
  class GeneratedAppModule {
    static forRoot(modeConfig: AppModeConfig): DynamicModule {
      // Merge baseConfig with optional custom config
      const configLoader = options.config ? () => ({ ...baseConfig, ...options.config() }) : () => baseConfig;

      // Resolve i18n path - use absolute path or resolve from cwd
      const i18nPath = options.i18n?.path
        ? path.isAbsolute(options.i18n.path)
          ? options.i18n.path
          : path.resolve(process.cwd(), options.i18n.path)
        : path.resolve(process.cwd(), "./i18n");

      return {
        module: GeneratedAppModule,
        imports: [
          // Event emitter for async events
          EventEmitterModule.forRoot(),

          // App mode configuration (API vs Worker)
          AppModeModule.forRoot(modeConfig),

          // Global configuration module
          ConfigModule.forRoot({
            load: [configLoader],
            isGlobal: true,
            cache: true,
          }),

          // Rate limiting - auto-configured from baseConfig
          ThrottlerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService<BaseConfigInterface>) => {
              const rateLimit = config.get<ConfigRateLimitInterface>("rateLimit");
              return {
                throttlers: [
                  { name: "default", ttl: rateLimit.ttl, limit: rateLimit.limit },
                  { name: "ip", ttl: rateLimit.ttl, limit: rateLimit.ipLimit },
                ],
              };
            },
          }),

          // CLS for request context
          ClsModule.forRoot({
            global: true,
            middleware: { mount: modeConfig.enableControllers },
          }),

          // i18n - optional with defaults
          I18nModule.forRoot({
            fallbackLanguage: options.i18n?.fallbackLanguage ?? "en",
            loaderOptions: {
              path: i18nPath,
              watch: true,
            },
            resolvers: [
              { use: QueryResolver, options: ["lang", "locale", "l"] },
              new HeaderResolver(["x-language"]),
              AcceptLanguageResolver,
            ],
          }),

          // Schedule module (only in worker mode for cron jobs)
          ...(modeConfig.enableCronJobs ? [ScheduleModule.forRoot()] : []),

          // Library's core infrastructure modules
          CoreModule.forRoot({ companyConfigurations: options.companyConfigurations }),

          // Library's foundation/domain modules
          FoundationsModule.forRoot({ chunkQueueIds: options.queueIds }),

          // Library's AI agents with optional custom prompts
          AgentsModule.forRoot(options.prompts ? { prompts: options.prompts } : undefined),

          // User's app-specific modules
          ...options.appModules,
        ],
        global: true,
        controllers: [],
      };
    }
  }

  return GeneratedAppModule;
}
