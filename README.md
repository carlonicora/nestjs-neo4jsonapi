# @carlonicora/nestjs-neo4jsonapi

A comprehensive NestJS foundation package providing JSON:API compliant APIs, Neo4j graph database integration, Redis caching, LangChain-based AI agents (including GraphRAG), and common utilities for building modern multi-tenant applications.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Quick Start](#quick-start)
- [Company-User Model (B2B & B2C)](#company-user-model-b2b--b2c)
- [Required Configuration Files](#required-configuration-files)
- [Core Modules](#core-modules)
- [Foundation Modules](#foundation-modules)
- [AI Agents](#ai-agents)
- [Security & Authentication](#security--authentication)
- [Customizing Agent Prompts](#customizing-agent-prompts-optional)
- [License](#license)

## Features

- **Dual-Mode Architecture**: Run as **API server** (HTTP endpoints) or **Worker** (background job processing) from the same codebase
- **JSON:API Compliance**: Full JSON:API specification support with serializers, pagination, and cursor-based navigation
- **Neo4j Integration**: Graph database operations with Cypher query builder
- **Redis Caching**: Built-in caching layer with configurable TTLs
- **Multi-Tenant Architecture**: Support for both B2B (multi-company) and B2C (single invisible company) scenarios
- **AI Agents**: LangChain-powered agents including GraphRAG for knowledge extraction, summarization, and intelligent responses
- **Authentication**: JWT-based authentication with role-based access control
- **Background Jobs**: BullMQ integration for async job processing
- **WebSockets**: Real-time communication support
- **Tracing**: OpenTelemetry integration for distributed tracing
- **Logging**: Structured logging with Loki integration

## API & Worker Modes

The library is designed to run in two modes from the same codebase:

### API Mode (HTTP Server)
- Handles HTTP requests via Fastify
- WebSocket connections for real-time features
- Uses `JwtAuthGuard` for authentication
- Adds jobs to BullMQ queues

### Worker Mode (Background Processing)
- Processes BullMQ jobs asynchronously
- Runs scheduled tasks (cron jobs)
- No HTTP server - just job processing
- Same configuration and modules as API

### Running Both Modes

```bash
# Start API server
node dist/main --mode=api

# Start Worker (in separate process)
node dist/main --mode=worker

# Or use the npm scripts
pnpm start:prod       # API mode
pnpm start:worker:prod # Worker mode
```

The mode is determined by the `--mode` flag and configured via `getAppMode()` and `getAppModeConfig()`:

## Architecture

The library is organized into four main layers:

```
@carlonicora/nestjs-neo4jsonapi
├── common/       # Shared utilities, abstracts, decorators, guards
├── config/       # Configuration system and tokens
├── core/         # Infrastructure modules (18 modules)
├── foundations/  # Domain/business modules (17 modules)
├── agents/       # AI agent modules (4 modules)
└── bootstrap/    # Application bootstrap utilities
```

## Installation

```bash
pnpm add @carlonicora/nestjs-neo4jsonapi
```

### Peer Dependencies

The following packages must be installed in your application:

```bash
pnpm add @nestjs/common @nestjs/core @nestjs/config @nestjs/event-emitter @nestjs/jwt @nestjs/passport @nestjs/platform-socket.io @nestjs/throttler @nestjs/websockets nestjs-cls zod
```

| Package      | Version  | Purpose                      |
| ------------ | -------- | ---------------------------- |
| `nestjs-cls` | ^6.0.1   | Request-scoped context (CLS) |
| `zod`        | ^4.0.0   | Schema validation            |

**Important**: These are peer dependencies to ensure your application and the library share the same package instances, preventing NestJS dependency injection issues.

## Environment Variables

Create a `.env` file with the following configuration:

```env
# Environment
ENV=development

# API
API_URL=http://localhost:3000/
API_PORT=3000

# App (frontend URL)
APP_URL=http://localhost:3001

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_USERNAME=
REDIS_QUEUE=default

# Cache
CACHE_ENABLED=true
CACHE_DEFAULT_TTL=600
CACHE_SKIP_PATTERNS=/access,/auth,/notifications,/websocket,/version

# JWT Authentication
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=1h

# CORS
CORS_ORIGINS=http://localhost:3001
CORS_CREDENTIALS=true

# AI Configuration (optional)
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini

# Embedder (optional)
EMBEDDER_PROVIDER=openai
EMBEDDER_API_KEY=sk-...
EMBEDDER_MODEL=text-embedding-3-small

# Logging - Loki (optional)
LOKI_ENABLED=false
LOKI_HOST=http://localhost:3100

# Tracing - Tempo (optional)
TEMPO_ENABLED=false
TEMPO_ENDPOINT=http://localhost:4318/v1/traces

# S3 Storage (optional)
S3_TYPE=aws
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=eu-west-1

# Email (optional)
EMAIL_PROVIDER=sendgrid
EMAIL_API_KEY=
EMAIL_FROM=noreply@example.com

# Stripe (optional)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Push Notifications (optional)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL=60000
RATE_LIMIT_REQUESTS=100

# Encryption
ENCRYPTION_KEY=your-32-char-encryption-key
```

## Quick Start

### 1. Create Configuration File

```typescript
// src/config/config.ts
import { baseConfig, ConfigInterface } from "@carlonicora/nestjs-neo4jsonapi";

export default (): ConfigInterface => {
  return {
    ...baseConfig,
    // Add app-specific config here (optional)
  };
};
```

### 2. Create Company Configurations

The library uses an abstract `CompanyConfigurations` class that you must extend to load company-specific data. This class is instantiated for each authenticated request and provides company-specific context (modules, features, settings) to your application.

```typescript
// src/config/company.configurations.ts
import { AbstractCompanyConfigurations, Neo4jService } from "@carlonicora/nestjs-neo4jsonapi";

// Import your app-specific entities if needed
import { Configuration } from "src/features/configurations/entities/configuration.entity";
import { ConfigurationModel } from "src/features/configurations/entities/configuration.model";

export class CompanyConfigurations extends AbstractCompanyConfigurations {
  constructor(params: { companyId: string; userId: string; language?: string; roles?: string[] }) {
    super(params);
  }

  async loadConfigurations(params: { neo4j: Neo4jService }): Promise<void> {
    if (!this._companyId) return;

    // Load company-specific modules, features, or settings from Neo4j
    const query = params.neo4j.initQuery({ serialiser: ConfigurationModel });
    query.query = `
      MATCH (configuration:Configuration {id: $companyId})<-[:HAS_CONFIGURATION]-(company:Company)
      OPTIONAL MATCH (company)-[:HAS_MODULE]-(configuration_module:Module)
      RETURN configuration, configuration_module
    `;

    const configuration: Configuration = await params.neo4j.readOne(query);

    if (configuration && configuration.module) {
      this.setModules(configuration.module);
    }
  }
}
```

**Important**: You must pass your `CompanyConfigurations` class to `CoreModule.forRoot()` so the library can instantiate it when loading user context (see Step 3 below).

### 3. Setup App Module

```typescript
// src/app.module.ts
import { DynamicModule, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { ClsModule } from "nestjs-cls";

import {
  AgentsModule,
  AppModeConfig,
  AppModeModule,
  BaseConfigInterface,
  ConfigRateLimitInterface,
  CoreModule,
  FoundationsModule,
} from "@carlonicora/nestjs-neo4jsonapi";

// App configuration
import config from "./config/config";

// Define your queue IDs
enum QueueId {
  CHUNK = "chunk",
}

// App-specific modules
import { CompanyConfigurations } from "src/config/company.configurations";
import { FeaturesModules } from "src/features/features.modules";

@Module({})
export class AppModule {
  static forRoot(modeConfig: AppModeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        // Event emitter for internal events
        EventEmitterModule.forRoot(),

        // App mode configuration (API vs Worker)
        AppModeModule.forRoot(modeConfig),

        // Configuration
        ConfigModule.forRoot({
          load: [config],
          isGlobal: true,
          cache: true,
        }),

        // Rate limiting
        ThrottlerModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService<BaseConfigInterface>) => {
            const rateLimitConfig = configService.get<ConfigRateLimitInterface>("rateLimit");
            return {
              throttlers: [
                {
                  name: "default",
                  ttl: rateLimitConfig.ttl,
                  limit: rateLimitConfig.limit,
                },
              ],
            };
          },
        }),

        // Request-scoped context (CLS) - required for user/company context
        ClsModule.forRoot({
          global: true,
          middleware: { mount: modeConfig.enableControllers },
        }),

        // Scheduled jobs (only enabled in worker mode)
        ...(modeConfig.enableCronJobs ? [ScheduleModule.forRoot()] : []),

        // ========================================
        // LIBRARY MODULES
        // ========================================

        // Core infrastructure (Neo4j, Redis, Cache, Security, etc.)
        // Pass your CompanyConfigurations class to enable company-specific context
        CoreModule.forRoot({ companyConfigurations: CompanyConfigurations }),

        // Foundation domain modules (User, Company, Auth, etc.)
        FoundationsModule.forRoot({
          chunkQueueIds: [QueueId.CHUNK],
        }),

        // AI Agents (GraphRAG, Summariser, Responder, etc.)
        AgentsModule.forRoot(),

        // ========================================
        // YOUR APP-SPECIFIC MODULES
        // ========================================
        FeaturesModules,
      ],
      global: true,
      controllers: [],
    };
  }
}
```

#### CoreModule.forRoot() Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `companyConfigurations` | `Type<AbstractCompanyConfigurations>` | No | Your custom class extending `AbstractCompanyConfigurations`. When provided, the library uses this class to load company-specific context (modules, features, settings) for each authenticated request. If not provided, a minimal stub is used. |

#### FoundationsModule.forRoot() Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `chunkQueueIds` | `string[]` | Yes | Queue IDs for the ChunkModule to register with BullMQ for document processing. |

### 4. Setup main.ts (Bootstrap)

```typescript
// src/main.ts
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables FIRST
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// Initialize tracing BEFORE any other imports
import { tracingSetup } from "@carlonicora/nestjs-neo4jsonapi";
tracingSetup.initialize();

import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory, Reflector } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { EventEmitter } from "stream";

import {
  AppLoggingService,
  AppMode,
  AppModeConfig,
  BaseConfigInterface,
  CacheInterceptor,
  CacheService,
  ConfigApiInterface,
  CorsService,
  getAppMode,
  getAppModeConfig,
  HttpExceptionFilter,
  LoggingInterceptor,
  TracingInterceptor,
} from "@carlonicora/nestjs-neo4jsonapi";

import { AppModule } from "./app.module";

async function bootstrapAPI(modeConfig: AppModeConfig): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(modeConfig),
    new FastifyAdapter({
      routerOptions: { ignoreTrailingSlash: true },
      bodyLimit: 100 * 1024 * 1024,
    }),
    { logger: ["error", "warn"] },
  );

  const configService = app.get(ConfigService<BaseConfigInterface>);

  // Register multipart support for file uploads
  await app.register(require("@fastify/multipart"), {
    limits: {
      fileSize: 100 * 1024 * 1024,
      fieldSize: 10 * 1024 * 1024,
      files: 10,
      fields: 20,
    },
    attachFieldsToBody: false,
  });

  // Setup logging
  const loggingService = app.get(AppLoggingService);
  app.useLogger(loggingService);

  // Add Fastify onSend hook for request logging
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", async (request, reply, payload) => {
      const startTime = request.raw["requestStartTime"];
      if (startTime) {
        const responseTime = Date.now() - startTime;
        loggingService.logHttpRequest(request.method, request.url, reply.statusCode, responseTime, request.ip);
        loggingService.clearRequestContext();
      }
      return payload;
    });

  // Global filters and pipes
  app.useGlobalFilters(new HttpExceptionFilter(loggingService));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Apply interceptors in order: Tracing -> Cache -> Logging
  app.useGlobalInterceptors(app.get(TracingInterceptor));
  app.useGlobalInterceptors(new CacheInterceptor(app.get(CacheService), app.get(Reflector), loggingService));
  app.useGlobalInterceptors(app.get(LoggingInterceptor));

  // Setup CORS
  const corsService = app.get(CorsService);
  corsService.validateConfiguration();
  app.enableCors(corsService.getCorsConfiguration());

  // Start server
  const port = configService.get<ConfigApiInterface>("api").port;
  await app.listen(port, "0.0.0.0");
  loggingService.log(`API server started on port ${port}`);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    await app.close();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    await app.close();
    process.exit(0);
  });
}

async function bootstrapWorker(modeConfig: AppModeConfig): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(modeConfig), {
    logger: ["error", "warn"],
  });

  const loggingService = app.get(AppLoggingService);
  app.useLogger(loggingService);
  loggingService.log("Worker process started");

  process.on("SIGTERM", async () => {
    await app.close();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    await app.close();
    process.exit(0);
  });
}

async function bootstrap(): Promise<void> {
  EventEmitter.defaultMaxListeners = 50;

  const mode = getAppMode();
  const modeConfig = getAppModeConfig(mode);

  if (mode === AppMode.WORKER) {
    await bootstrapWorker(modeConfig);
  } else {
    await bootstrapAPI(modeConfig);
  }
}

bootstrap();
```

## Company-User Model (B2B & B2C)

The library implements a flexible multi-tenant architecture that supports both **B2B** (Business-to-Business) and **B2C** (Business-to-Consumer) scenarios through the Company-User relationship.

### The Relationship

```
Company (1) <--[BELONGS_TO]-- (*) User
   |
   +--[HAS_MODULE]--> Module (features available to company)
   +--[HAS_FEATURE]--> Feature (feature flags)
```

### User Entity

```typescript
type User = {
  id: string;
  email: string;
  name?: string;
  password?: string;
  avatar?: string;
  isActive: boolean;
  isDeleted: boolean;

  role?: Role[];      // User's roles within the company
  company?: Company;  // The company this user belongs to
  module?: Module[];  // Modules assigned to this specific user
};
```

### Company Entity

```typescript
type Company = {
  id: string;
  name: string;
  logo?: string;
  isActiveSubscription: boolean;
  ownerEmail: string;
  availableTokens: number;

  feature: Feature[];  // Features available to company
  module: Module[];    // Modules available to company
};
```

### Roles and UUIDs

**Important**: All role IDs in the library are UUIDs, not string names. The library provides base system roles that you can extend:

```typescript
// src/config/roles.ts
import { SystemRoles } from "@carlonicora/nestjs-neo4jsonapi";

/**
 * Extend the base SystemRoles with your application-specific roles.
 * All role IDs MUST be UUIDs.
 */
export const AppRoles = {
  // Base roles from the library
  ...SystemRoles,

  // Your application-specific roles (UUIDs)
  Manager: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  Editor: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  Viewer: "c3d4e5f6-a7b8-9012-cdef-123456789012",
} as const;

export type AppRoleId = (typeof AppRoles)[keyof typeof AppRoles];
```

The base `SystemRoles` includes:
- `Administrator`: `"53394cb8-1e87-11ef-8b48-bed54b8f8aba"` - System-wide admin
- `CompanyAdministrator`: `"2e1eee00-6cba-4506-9059-ccd24e4ea5b0"` - Company-level admin

### B2B Scenario (Multi-Tenant)

In a B2B application, companies are visible and central to the user experience:

- Each company has multiple users
- Users see company branding, shared data, and collaborate within their company
- Company administrators manage users, modules, and settings
- Data is segregated by company

```typescript
import { SystemRoles } from "@carlonicora/nestjs-neo4jsonapi";
import { AppRoles } from "./config/roles";

// Example: User registration in B2B
async function registerB2BUser(email: string, companyId: string) {
  // User explicitly joins an existing company
  // Note: roles must be UUIDs, not string names!
  const user = await userService.create({
    email,
    companyId,  // Links to existing company
    roles: [AppRoles.Viewer],  // UUID: "c3d4e5f6-a7b8-9012-cdef-123456789012"
  });
}

// Example: Create company admin
async function createCompanyAdmin(email: string, companyId: string) {
  const user = await userService.create({
    email,
    companyId,
    roles: [SystemRoles.CompanyAdministrator],  // UUID from library
  });
}
```

### B2C Scenario (Single User)

In a B2C application, companies are **invisible** but still exist in the database:

- Each user gets their own "personal" company created automatically
- The company provides data isolation and the same multi-tenant security
- Users are unaware they have a company - it's an implementation detail
- This allows future upgrades to B2B (invite team members) without restructuring

```typescript
import { SystemRoles } from "@carlonicora/nestjs-neo4jsonapi";

// Example: User registration in B2C
async function registerB2CUser(email: string) {
  // Create a personal/invisible company for this user
  const company = await companyService.create({
    name: `${email}'s workspace`,  // Or generate a UUID
    ownerEmail: email,
  });

  // Create user linked to their personal company
  // They are the administrator of their own space
  const user = await userService.create({
    email,
    companyId: company.id,
    roles: [SystemRoles.CompanyAdministrator],  // UUID - owner of personal space
  });
}
```

### How the Library Uses This

1. **JWT Token**: Contains `userId`, `companyId`, and `roles`
2. **JwtAuthGuard**: Validates token and loads company configurations via `COMPANY_CONFIGURATIONS_FACTORY`
3. **CLS Context**: Stores `companyId` and `userId` for the request lifecycle
4. **Neo4j Queries**: Automatically scoped to `$companyId` via `initQuery()`

```typescript
// All queries are automatically company-scoped
const query = neo4jService.initQuery({ serialiser: UserModel });
query.query = `
  MATCH (company:Company {id: $companyId})
  MATCH (user:User)-[:BELONGS_TO]->(company)
  RETURN user
`;
// $companyId is automatically injected from CLS context
```

### Benefits

| Benefit | B2B | B2C |
|---------|-----|-----|
| Data isolation | Per company | Per user (via invisible company) |
| User collaboration | Yes | No (single user) |
| Scalability | Multi-tenant | Same architecture |
| Future B2B upgrade | Already supported | Easy migration path |
| Billing | Per company | Per user (mapped to company) |

## Required Configuration Files

### File Structure

```
your-app/
├── src/
│   ├── config/
│   │   ├── config.ts                 # App configuration
│   │   ├── company.configurations.ts # Company context loader
│   │   └── enums/
│   │       └── queue.id.ts           # Queue identifiers
│   ├── features/                     # Your app-specific modules
│   ├── app.module.ts
│   └── main.ts
├── .env
└── package.json
```

### Queue IDs (if using background jobs)

```typescript
// src/config/enums/queue.id.ts
export enum QueueId {
  CHUNK = "chunk",
  // Add your custom queue IDs
  EMAIL = "email",
  NOTIFICATIONS = "notifications",
}
```

## Core Modules

The library includes 18 core infrastructure modules:

| Module            | Description                                      |
| ----------------- | ------------------------------------------------ |
| `Neo4JModule`     | Neo4j graph database integration                 |
| `RedisModule`     | Redis client and messaging                       |
| `CacheModule`     | Distributed caching layer                        |
| `SecurityModule`  | JWT authentication and role-based access control |
| `JsonApiModule`   | JSON:API specification compliance                |
| `LoggingModule`   | Structured logging with Loki                     |
| `TracingModule`   | Distributed tracing with OpenTelemetry           |
| `EmailModule`     | Email service (SendGrid, SMTP)                   |
| `QueueModule`     | BullMQ job queue processing                      |
| `WebsocketModule` | Real-time WebSocket communication                |
| `CorsModule`      | CORS configuration                               |
| `VersionModule`   | API versioning                                   |
| `StripeModule`    | Stripe payment integration                       |
| `LLMModule`       | LLM service for AI operations                    |
| `BlockNoteModule` | Block editor support                             |
| `MigratorModule`  | Database migrations                              |
| `AppModeModule`   | Application mode (API/Worker)                    |
| `DebugModule`     | Debugging utilities                              |

## Foundation Modules

The library includes 17 foundation modules for business domain logic:

| Module               | Description                                      |
| -------------------- | ------------------------------------------------ |
| `UserModule`         | User management with CRUD operations             |
| `CompanyModule`      | Multi-tenant company management                  |
| `AuthModule`         | Authentication (login, register, password reset) |
| `RoleModule`         | Role management                                  |
| `ChunkModule`        | Document chunk storage and retrieval             |
| `ChunkerModule`      | Document parsing (PDF, DOCX, XLSX, HTML)         |
| `AtomicFactModule`   | Atomic facts management for knowledge graphs     |
| `KeyConceptModule`   | Key concepts for knowledge graphs                |
| `ContentModule`      | Content management                               |
| `NotificationModule` | User notifications                               |
| `PushModule`         | Push notifications (VAPID)                       |
| `FeatureModule`      | Feature flag management                          |
| `ModuleModule`       | Module/plugin management                         |
| `S3Module`           | S3-compatible storage                            |
| `TokenUsageModule`   | AI token usage tracking                          |
| `AuditModule`        | Audit logging                                    |
| `RelevancyModule`    | Relevancy scoring                                |

## AI Agents

LangChain-powered agents for intelligent document processing.

### GraphCreatorModule

Extracts knowledge graphs from text, including atomic facts and key concept relationships.

```typescript
import { GraphCreatorService } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class MyService {
  constructor(private readonly graphCreator: GraphCreatorService) {}

  async extractKnowledge(text: string) {
    const result = await this.graphCreator.generateGraph({ content: text });
    // result contains: atomicFacts, keyConceptsRelationships, tokens
    return result;
  }
}
```

### ContextualiserModule (GraphRAG)

Implements **GraphRAG** (Graph-based Retrieval Augmented Generation) for intelligent context gathering:

- Uses a knowledge graph structure (Neo4j)
- Traverses atomic facts and key concepts
- Explores neighbouring nodes for richer context

```typescript
import { ContextualiserService } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class MyService {
  constructor(private readonly contextualiser: ContextualiserService) {}

  async gatherContext(question: string) {
    return this.contextualiser.contextualise({ question });
  }
}
```

### SummariserModule

Generates summaries from document chunks using a map-reduce pattern.

```typescript
import { SummariserService } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class MyService {
  constructor(private readonly summariser: SummariserService) {}

  async summarize(chunks: Chunk[]) {
    const result = await this.summariser.summarise({ chunks });
    // result contains: content, tldr, tokens
    return result;
  }
}
```

### ResponderModule

Generates comprehensive answers based on gathered context.

```typescript
import { ResponderService } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class MyService {
  constructor(private readonly responder: ResponderService) {}

  async generateAnswer(context: any) {
    return this.responder.respond(context);
  }
}
```

## Security & Authentication

### Using Guards

```typescript
import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, AdminJwtAuthGuard, OptionalJwtAuthGuard, Roles, SystemRoles } from "@carlonicora/nestjs-neo4jsonapi";
import { AppRoles } from "./config/roles";

@Controller("api/resources")
export class ResourceController {
  // Requires valid JWT token
  @Get()
  @UseGuards(JwtAuthGuard)
  async getResources() { ... }

  // Requires Administrator role (uses AdminJwtAuthGuard)
  @Get("admin")
  @UseGuards(AdminJwtAuthGuard)
  async getAdminResources() { ... }

  // JWT is optional - works for both authenticated and anonymous users
  @Get("public")
  @UseGuards(OptionalJwtAuthGuard)
  async getPublicResources() { ... }

  // Requires specific roles (UUIDs)
  @Get("restricted")
  @UseGuards(JwtAuthGuard)
  @Roles(SystemRoles.Administrator, SystemRoles.CompanyAdministrator)
  async getRestrictedResources() { ... }

  // Using your custom app roles
  @Get("managers-only")
  @UseGuards(JwtAuthGuard)
  @Roles(AppRoles.Manager, SystemRoles.Administrator)
  async getManagerResources() { ... }
}
```

### Accessing User Context

```typescript
import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { CompanyConfigurationsInterface } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class MyService {
  constructor(private readonly cls: ClsService) {}

  async doSomething() {
    // Access current user/company context
    const userId = this.cls.get("userId");
    const companyId = this.cls.get("companyId");
    const roles = this.cls.get("roles");
    const language = this.cls.get("language");

    // Access company configurations (loaded by JwtAuthGuard)
    const config = this.cls.get<CompanyConfigurationsInterface>("companyConfigurations");

    if (config?.hasModule("premium-feature")) {
      // User's company has access to premium feature
    }
  }
}
```

## Customizing Agent Prompts (Optional)

The library includes default prompts. Customization is entirely optional.

### Available Prompts

| Agent              | Prompt                                   | Purpose                               |
| ------------------ | ---------------------------------------- | ------------------------------------- |
| **GraphCreator**   | `GRAPH_CREATOR_PROMPT`                   | Extract atomic facts and key concepts |
| **Contextualiser** | `CONTEXTUALISER_QUESTION_REFINER_PROMPT` | Refine user questions                 |
| **Contextualiser** | `CONTEXTUALISER_RATIONAL_PROMPT`         | Create rational plans                 |
| **Contextualiser** | `CONTEXTUALISER_KEYCONCEPTS_PROMPT`      | Score key concepts                    |
| **Contextualiser** | `CONTEXTUALISER_ATOMICFACTS_PROMPT`      | Evaluate atomic facts                 |
| **Contextualiser** | `CONTEXTUALISER_CHUNK_PROMPT`            | Assess text chunks                    |
| **Responder**      | `RESPONDER_ANSWER_PROMPT`                | Generate final answers                |
| **Summariser**     | `SUMMARISER_MAP_PROMPT`                  | Summarize individual chunks           |
| **Summariser**     | `SUMMARISER_COMBINE_PROMPT`              | Combine summaries                     |
| **Summariser**     | `SUMMARISER_TLDR_PROMPT`                 | Create TLDR                           |

### Custom Prompts Example

```typescript
// src/app.module.ts
AgentsModule.forRoot({
  prompts: {
    graphCreator: "Your custom graph creator prompt...",
    contextualiser: {
      questionRefiner: "Your custom question refiner prompt...",
    },
    summariser: {
      map: "Your custom map prompt...",
    },
  },
}),
```

## License

This project is licensed under GPL v3 for open source use.

For commercial/closed-source licensing, contact: [@carlonicora](https://github.com/carlonicora)

## Author

Carlo Nicora - [@carlonicora](https://github.com/carlonicora)
