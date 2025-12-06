import { BaseConfigInterface } from "./interfaces/base.config.interface";
import { ConfigChunkQueuesInterface } from "./interfaces/config.chunk.queues.interface";
import { ConfigContentTypesInterface } from "./interfaces/config.content.types.interface";
import { ConfigJobNamesInterface } from "./interfaces/config.job.names.interface";
import { ConfigPromptsInterface } from "./interfaces/config.prompts.interface";

/**
 * Options for createBaseConfig
 */
export interface BaseConfigOptions {
  /**
   * Application name used in logging labels and service names
   * @default 'nestjs-app'
   */
  appName?: string;

  /**
   * Environment type override
   * @default 'api'
   */
  environmentType?: "api" | "worker";

  /**
   * Custom prompts for AI agents (GraphCreator, Contextualiser, Responder, Summariser).
   * All prompts are optional - the library includes working defaults.
   */
  prompts?: ConfigPromptsInterface;

  /**
   * Additional queue IDs for chunk processing.
   * The library always registers its own CHUNK queue.
   * Use this to register additional queues that ChunkService needs to add jobs to.
   */
  chunkQueues?: ConfigChunkQueuesInterface;

  /**
   * Content type labels for multi-label content queries.
   * These are the Neo4j labels used for content nodes (e.g., ["Article", "Document"]).
   */
  contentTypes?: ConfigContentTypesInterface;

  /**
   * Job names for BullMQ processors.
   * Defines the job names that processors use to match incoming jobs.
   */
  jobNames?: ConfigJobNamesInterface;
}

/**
 * Creates the base configuration object from environment variables.
 *
 * This function loads all standard configuration from environment variables.
 * Use it in your NestJS ConfigModule:
 *
 * @example
 * ```typescript
 * // Simple usage - just use the library config
 * ConfigModule.forRoot({
 *   isGlobal: true,
 *   load: [() => createBaseConfig({ appName: 'my-app' })],
 * })
 *
 * // Extended usage - add app-specific config
 * ConfigModule.forRoot({
 *   isGlobal: true,
 *   load: [() => ({
 *     ...createBaseConfig({ appName: 'my-app' }),
 *     myCustomSetting: process.env.MY_SETTING,
 *   })],
 * })
 * ```
 */
export function createBaseConfig(options?: BaseConfigOptions): BaseConfigInterface {
  const appName = options?.appName || "nestjs-app";
  const environmentType = options?.environmentType || "api";

  const config = {
    environment: {
      type: environmentType,
    },
    api: {
      url: process.env.API_URL
        ? process.env.API_URL.endsWith("/")
          ? process.env.API_URL
          : `${process.env.API_URL}/`
        : "http://localhost:3000/",
      port: parseInt(process.env.API_PORT || "3000"),
      env: process.env.ENV || "development",
    },
    app: {
      url: process.env.APP_URL ? process.env.APP_URL.trim().replace(/\/+$/, "") : "http://localhost:3000",
    },
    neo4j: {
      uri: process.env.NEO4J_URI || "",
      username: process.env.NEO4J_USER || "",
      password: process.env.NEO4J_PASSWORD || "",
      database: process.env.NEO4J_DATABASE || "",
    },
    redis: {
      host: process.env.REDIS_HOST || "",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || "",
      username: process.env.REDIS_USERNAME || "",
      queue: process.env.REDIS_QUEUE || "default",
    },
    cache: {
      enabled: process.env.CACHE_ENABLED !== "false",
      defaultTtl: parseInt(process.env.CACHE_DEFAULT_TTL || "600"),
      skipPatterns: (process.env.CACHE_SKIP_PATTERNS || "/access,/auth,/notifications,/websocket,/version").split(","),
    },
    cors: {
      origins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
        : ["http://localhost:3000"],
      originPatterns: process.env.CORS_ORIGIN_PATTERNS
        ? process.env.CORS_ORIGIN_PATTERNS.split(",").map((pattern) => pattern.trim())
        : [],
      credentials: process.env.CORS_CREDENTIALS !== "false",
      methods: process.env.CORS_METHODS || "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
      allowedHeaders: process.env.CORS_ALLOWED_HEADERS || "Content-Type,Authorization,X-Requested-With",
      maxAge: parseInt(process.env.CORS_MAX_AGE || "86400"),
      preflightContinue: process.env.CORS_PREFLIGHT_CONTINUE === "true",
      optionsSuccessStatus: parseInt(process.env.CORS_OPTIONS_SUCCESS_STATUS || "204"),
      logViolations: process.env.CORS_LOG_VIOLATIONS !== "false",
    },
    jwt: {
      secret: process.env.JWT_SECRET || "",
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    },
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY || "",
      privateKey: process.env.VAPID_PRIVATE_KEY || "",
      email: process.env.VAPID_EMAIL || "",
    },
    email: {
      emailProvider: (process.env.EMAIL_PROVIDER === "smtp" ? "smtp" : "sendgrid") as "sendgrid" | "smtp",
      emailApiKey: process.env.EMAIL_API_KEY || "",
      emailFrom: process.env.EMAIL_FROM || "",
      emailHost: process.env.EMAIL_HOST || "",
      emailPort: +process.env.EMAIL_PORT || 0,
      emailSecure: process.env.EMAIL_SECURE === "true",
      emailUsername: process.env.EMAIL_USERNAME || "",
      emailPassword: process.env.EMAIL_PASSWORD || "",
    },
    logging: {
      loki: {
        enabled: process.env.LOKI_ENABLED === "true",
        host: process.env.LOKI_HOST || "http://localhost:3100",
        username: process.env.LOKI_USERNAME || "",
        password: process.env.LOKI_PASSWORD || "",
        batching: process.env.LOKI_BATCHING !== "false",
        interval: parseInt(process.env.LOKI_INTERVAL || "30"),
        labels: {
          application: process.env.LOKI_APP_LABEL || appName,
          environment: process.env.ENV || "development",
        },
      },
    },
    tempo: {
      enabled: process.env.TEMPO_ENABLED === "true",
      endpoint: process.env.TEMPO_ENDPOINT || "http://localhost:4318/v1/traces",
      serviceName: process.env.TEMPO_SERVICE_NAME || appName,
      serviceVersion: process.env.TEMPO_SERVICE_VERSION || "1.0.0",
    },
    s3: {
      type: process.env.S3_TYPE || "",
      endpoint: process.env.S3_ENDPOINT || "",
      bucket: process.env.S3_BUCKET || "",
      key: process.env.S3_ACCESS_KEY_ID || "",
      secret: process.env.S3_SECRET_ACCESS_KEY || "",
      region: process.env.S3_REGION || "us-east-1",
    },
    ai: {
      ai: {
        provider: process.env.AI_PROVIDER || "",
        apiKey: process.env.AI_API_KEY || "",
        model: process.env.AI_MODEL || "",
        url: process.env.AI_URL || "",
        region: process.env.AI_REGION || "",
        secret: process.env.AI_SECRET || "",
        instance: process.env.AI_INSTANCE || "",
        apiVersion: process.env.AI_API_VERSION || "",
        inputCostPer1MTokens: parseFloat(process.env.AI_INPUT_COST_PER_1M_TOKENS || "0"),
        outputCostPer1MTokens: parseFloat(process.env.AI_OUTPUT_COST_PER_1M_TOKENS || "0"),
      },
      transcriber: {
        provider: process.env.TRANSCRIBER_PROVIDER || "",
        apiKey: process.env.TRANSCRIBER_API_KEY || "",
        model: process.env.TRANSCRIBER_MODEL || "",
        url: process.env.TRANSCRIBER_URL || "",
        apiVersion: process.env.TRANSCRIBER_API_VERSION || "",
      },
      embedder: {
        provider: process.env.EMBEDDER_PROVIDER || "",
        apiKey: process.env.EMBEDDER_API_KEY || "",
        url: process.env.EMBEDDER_URL || "",
        model: process.env.EMBEDDER_MODEL || "",
        instance: process.env.EMBEDDER_INSTANCE || "",
        apiVersion: process.env.EMBEDDER_API_VERSION || "",
      },
    },
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED !== "false",
      ttl: parseInt(process.env.RATE_LIMIT_TTL || "60000"),
      limit: parseInt(process.env.RATE_LIMIT_REQUESTS || "100"),
      ipLimit: parseInt(process.env.IP_RATE_LIMIT_REQUESTS || "20"),
    },
    encryption: {
      key: process.env.ENCRYPTION_KEY || "",
    },
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || "",
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
      apiVersion: process.env.STRIPE_API_VERSION || "2024-12-18.acacia",
      portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL || "",
      portalConfigurationId: process.env.STRIPE_PORTAL_CONFIGURATION_ID || "",
    },
    prompts: options?.prompts ?? {},
    chunkQueues: options?.chunkQueues ?? { queueIds: [] },
    contentTypes: options?.contentTypes ?? { types: [] },
    jobNames: options?.jobNames ?? { process: {}, notifications: {} },
  };
  return config;
}

/**
 * Pre-configured base configuration instance.
 * Uses environment variables to configure all services.
 *
 * This is the recommended way to use the library's configuration
 * when you don't need to customize the config options.
 *
 * @example
 * ```typescript
 * import { baseConfig } from '@carlonicora/nestjs-neo4jsonapi';
 *
 * // Use in ThrottlerModule
 * ThrottlerModule.forRoot({
 *   throttlers: [
 *     { ttl: baseConfig.rateLimit.ttl, limit: baseConfig.rateLimit.limit },
 *   ],
 * })
 *
 * // Use in CoreModule.forRoot() - automatically uses baseConfig internally
 * CoreModule.forRoot()
 * ```
 */
export const baseConfig = createBaseConfig();
