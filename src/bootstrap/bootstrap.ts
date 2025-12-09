import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory, Reflector } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { EventEmitter } from "stream";

import { HttpExceptionFilter } from "../common/filters/http-exception.filter";
import { BaseConfigInterface, ConfigApiInterface, ConfigRateLimitInterface } from "../config";
import { AppMode, AppModeConfig } from "../core/appmode/constants/app.mode.constant";
import { CacheInterceptor } from "../core/cache/interceptors/cache.interceptor";
import { CacheService } from "../core/cache/services/cache.service";
import { CorsService } from "../core/cors/services/cors.service";
import { LoggingInterceptor } from "../core/logging/interceptors/logging.interceptor";
import { AppLoggingService } from "../core/logging/services/logging.service";
import { TracingInterceptor } from "../core/tracing/interceptors/tracing.interceptor";
import { tracingSetup } from "../core/tracing/tracing.setup";

import { createAppModule } from "./app.module.factory";
import { BootstrapOptions } from "./bootstrap.options";
import { defaultFastifyOptions, defaultMultipartOptions, getAppMode, getAppModeConfig } from "./defaults";

/**
 * Bootstrap the application with minimal configuration.
 *
 * This function handles all the complexity of setting up a NestJS application:
 * - Initializes tracing
 * - Determines API vs Worker mode from CLI args
 * - Creates the appropriate application type
 * - Configures all middleware, interceptors, and filters
 * - Sets up graceful shutdown handlers
 *
 * @example
 * ```typescript
 * // main.ts
 * import * as dotenv from "dotenv";
 * dotenv.config({ path: "path/to/.env" });
 *
 * import { bootstrap } from "@carlonicora/nestjs-neo4jsonapi";
 * import { FeaturesModules } from "./features/features.modules";
 *
 * bootstrap({
 *   queueIds: ["chunk"],
 *   appModules: [FeaturesModules],
 *   i18n: { fallbackLanguage: "en", path: "./src/i18n" },
 * });
 * ```
 *
 * @param options - Configuration options for the application
 */
export async function bootstrap(options: BootstrapOptions): Promise<void> {
  // Initialize tracing before anything else
  tracingSetup.initialize();

  // Increase max listeners for complex applications
  EventEmitter.defaultMaxListeners = 50;

  const mode = getAppMode();
  const modeConfig = getAppModeConfig(mode);
  const AppModule = createAppModule(options);

  try {
    if (mode === AppMode.WORKER) {
      await bootstrapWorker(AppModule, modeConfig);
    } else {
      await bootstrapAPI(AppModule, modeConfig);
    }
  } catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
  }
}

/**
 * Bootstrap the application in API mode with Fastify
 */
async function bootstrapAPI(AppModule: any, modeConfig: AppModeConfig): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(modeConfig),
    new FastifyAdapter(defaultFastifyOptions),
    { logger: ["error", "warn"] },
  );

  const configService = app.get(ConfigService<BaseConfigInterface>);
  const loggingService = app.get(AppLoggingService);

  // Register multipart for file uploads
  await app.register(require("@fastify/multipart"), defaultMultipartOptions);

  // Setup logging
  app.useLogger(loggingService);
  setupFastifyLoggingHook(app, loggingService);

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter(loggingService));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      validateCustomDecorators: true,
    }),
  );

  // Log rate limiting status
  const rateLimitConfig = configService.get<ConfigRateLimitInterface>("rateLimit");
  if (rateLimitConfig?.enabled) {
    loggingService.log(`Rate limiting enabled: ${rateLimitConfig.limit} requests per ${rateLimitConfig.ttl}ms`);
  } else {
    loggingService.log("Rate limiting disabled");
  }

  // Apply interceptors in the correct order: Tracing -> Cache -> Logging
  app.useGlobalInterceptors(app.get(TracingInterceptor));
  app.useGlobalInterceptors(new CacheInterceptor(app.get(CacheService), app.get(Reflector), loggingService));
  app.useGlobalInterceptors(app.get(LoggingInterceptor));

  // CORS configuration
  const corsService = app.get(CorsService);
  corsService.validateConfiguration();
  app.enableCors(corsService.getCorsConfiguration());

  // Start server
  const port = configService.get<ConfigApiInterface>("api").port;
  await app.listen(port, "0.0.0.0");

  console.info(`API server started on port ${port}`);
  loggingService.log(`API server started on port ${port}`);

  // Graceful shutdown
  setupGracefulShutdown(app);
}

/**
 * Bootstrap the application in Worker mode (background job processing)
 */
async function bootstrapWorker(AppModule: any, modeConfig: AppModeConfig): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(modeConfig), {
    logger: ["error", "warn"],
  });

  const loggingService = app.get(AppLoggingService);
  app.useLogger(loggingService);

  console.info("Worker process started");
  loggingService.log("Worker process started");

  setupGracefulShutdown(app);
}

/**
 * Setup Fastify hook to log HTTP requests with accurate timing
 */
function setupFastifyLoggingHook(app: NestFastifyApplication, loggingService: AppLoggingService): void {
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", async (request, reply, payload) => {
      const startTime = request.raw["requestStartTime"];

      if (startTime) {
        const responseTime = Date.now() - startTime;
        const statusCode = reply.statusCode || 200;
        let resultSize = 0;
        try {
          resultSize = payload ? (typeof payload === "string" ? payload.length : JSON.stringify(payload).length) : 0;
        } catch {
          resultSize = 0;
        }

        loggingService.logHttpRequest(request.method, request.url, statusCode, responseTime, request.ip);

        loggingService.logWithContext(`Request completed successfully`, "HTTP_SUCCESS", {
          responseTime,
          statusCode,
          resultSize,
          loggedFromOnSend: true,
        });

        loggingService.clearRequestContext();
      }
      return payload;
    });
}

/**
 * Setup graceful shutdown handlers for SIGTERM and SIGINT
 */
function setupGracefulShutdown(app: any): void {
  const shutdown = async (signal: string) => {
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      console.error(`Error during ${signal} shutdown:`, error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
