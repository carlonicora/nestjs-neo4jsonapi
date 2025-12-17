import { DynamicModule, Module, Type } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { GatewayIntentBits } from "discord.js";
import { NecordModule } from "necord";
import { ClsModule } from "nestjs-cls";
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from "nestjs-i18n";
import * as path from "path";

import { AgentsModule } from "../agents/agents.modules";
import { baseConfig, BaseConfigInterface, ConfigDiscordInterface, ConfigRateLimitInterface } from "../config";
import { DiscordModule } from "../foundations/discord/discord.module";
import { AppModeModule } from "../core/appmode/app.mode.module";
import { AppModeConfig } from "../core/appmode/constants/app.mode.constant";
import { CoreModule } from "../core/core.module";
import { FoundationsModule } from "../foundations/foundations.modules";
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
      // Get app config for extracting queue IDs (needed at module definition time)
      const appConfig = options.config ? options.config() : {};
      const queueIds = appConfig.chunkQueues?.queueIds ?? [];

      // Merge baseConfig with optional custom config
      const configLoader = options.config ? () => ({ ...baseConfig, ...appConfig }) : () => baseConfig;

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
          CoreModule.forRoot({
            queueIds,
          }),

          // Library's foundation/domain modules (queues configured via baseConfig.chunkQueues)
          FoundationsModule.forRoot({
            contentExtension: options.contentExtension,
          }),

          // Library's AI agents (prompts configured via baseConfig.prompts)
          AgentsModule,

          // User's app-specific modules (MUST be before NecordModule so Necord can discover handlers)
          ...options.appModules,

          // Discord bot (only in worker mode when token is configured)
          // IMPORTANT: Must be AFTER appModules so Necord can discover decorated handlers
          ...(modeConfig.enableCronJobs && process.env.DISCORD_TOKEN
            ? [
                NecordModule.forRootAsync({
                  imports: [ConfigModule],
                  inject: [ConfigService],
                  useFactory: (config: ConfigService<BaseConfigInterface>) => {
                    const discord = config.get<ConfigDiscordInterface>("discord");
                    return {
                      token: discord.token,
                      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
                      development: discord.devGuildId ? [discord.devGuildId] : false,
                    };
                  },
                }),
                DiscordModule,
              ]
            : []),
        ],
        global: true,
        controllers: [],
      };
    }
  }

  return GeneratedAppModule;
}
