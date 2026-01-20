import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory, Reflector } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { EventEmitter } from "stream";

import { HttpExceptionFilter } from "../common/filters/http-exception.filter";
import { OpenApiService } from "../openapi/module/openapi.service";
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
import { setupRawBodyCapture } from "./raw-body.config";

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
      await bootstrapAPI(AppModule, modeConfig, options);
    }
  } catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
  }
}

/**
 * Bootstrap the application in API mode with Fastify
 */
async function bootstrapAPI(AppModule: any, modeConfig: AppModeConfig, options: BootstrapOptions): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(modeConfig),
    new FastifyAdapter(defaultFastifyOptions),
    { logger: ["error", "warn"] },
  );

  const configService = app.get(ConfigService<BaseConfigInterface>);
  const loggingService = app.get(AppLoggingService);

  // Setup raw body capture for webhook routes (MUST be before route registration)
  await setupRawBodyCapture(app);

  // Register multipart for file uploads
  await app.register(require("@fastify/multipart"), defaultMultipartOptions);

  // Register JSON:API content type parser (treats application/vnd.api+json as JSON)
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addContentTypeParser(
    "application/vnd.api+json",
    { parseAs: "string" },
    fastifyInstance.getDefaultJsonParser("ignore", "ignore"),
  );

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

  // Setup OpenAPI documentation
  await setupOpenApiDocs(app, options, loggingService);

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
 * Setup OpenAPI documentation (Swagger UI and/or Redoc)
 */
async function setupOpenApiDocs(
  app: NestFastifyApplication,
  options: BootstrapOptions,
  loggingService: AppLoggingService,
): Promise<void> {
  const openApiConfig = options.openApi;
  if (!openApiConfig?.enableSwagger && !openApiConfig?.enableRedoc) {
    return;
  }

  const {
    title = "API Documentation",
    description = "Auto-generated API documentation",
    version = "1.0.0",
    bearerAuth = true,
    contactEmail,
    license,
    licenseUrl,
    swaggerPath = "/api-docs",
    redocPath = "/docs",
  } = openApiConfig;

  // Build OpenAPI document
  const documentBuilder = new DocumentBuilder().setTitle(title).setDescription(description).setVersion(version);

  if (bearerAuth) {
    documentBuilder.addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Enter your JWT token",
      },
      "JWT-auth",
    );
  }

  if (contactEmail) {
    documentBuilder.setContact("API Support", "", contactEmail);
  }

  if (license) {
    documentBuilder.setLicense(license, licenseUrl || "");
  }

  const config = documentBuilder.build();

  // Get schemas from OpenApiService
  let extraSchemas: Record<string, any> = {};
  try {
    const openApiService = app.get(OpenApiService);

    // Register entity descriptors if provided
    if (openApiConfig.entityDescriptors && openApiConfig.entityDescriptors.length > 0) {
      openApiService.registerEntities(openApiConfig.entityDescriptors);
      loggingService.log(`Registered ${openApiConfig.entityDescriptors.length} entities with OpenAPI`);
    }

    extraSchemas = openApiService.getAllSchemas();
  } catch {
    loggingService.warn("OpenApiService not available, using base schemas only");
  }

  // Create document with extra schemas
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [],
  });

  // Merge extra schemas into components
  document.components = document.components || {};
  document.components.schemas = {
    ...document.components.schemas,
    ...extraSchemas,
  };

  // Setup Swagger UI
  if (openApiConfig.enableSwagger) {
    SwaggerModule.setup(swaggerPath, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: "none",
        filter: true,
        showRequestDuration: true,
      },
    });
    loggingService.log(`Swagger UI available at ${swaggerPath}`);
  }

  // Setup Redoc
  if (openApiConfig.enableRedoc) {
    try {
      const { RedocModule } = await import("nestjs-redoc");
      await RedocModule.setup(redocPath, app as any, document, {
        title: title,
        sortPropsAlphabetically: true,
        hideDownloadButton: false,
        hideHostname: false,
      });
      loggingService.log(`Redoc available at ${redocPath}`);
    } catch {
      loggingService.warn("Failed to setup Redoc. Make sure nestjs-redoc is installed.");
    }
  }
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
