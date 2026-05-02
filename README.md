# @carlonicora/nestjs-neo4jsonapi

A comprehensive NestJS foundation package providing JSON:API compliant APIs, Neo4j graph database integration, Redis caching, LangChain-based AI agents (including GraphRAG and DRIFT), OAuth 2.0 server, OpenAPI documentation, and common utilities for building modern multi-tenant applications.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Quick Start](#quick-start)
- [Company-User Model (B2B & B2C)](#company-user-model-b2b--b2c)
- [Required Configuration Files](#required-configuration-files)
- [Core Modules](#core-modules)
- [Health Check Endpoints](#health-check-endpoints)
- [Foundation Modules](#foundation-modules)
- [AI Agents](#ai-agents)
- [DRIFT Module (Advanced Semantic Search)](#drift-module-advanced-semantic-search)
- [OpenAPI Documentation](#openapi-documentation)
- [OAuth 2.0 Support](#oauth-20-support)
- [Security & Authentication](#security--authentication)
- [Company Deletion Handler](#company-deletion-handler)
- [Entity Descriptors (defineEntity)](#entity-descriptors-defineentity)
- [Customizing Agent Prompts](#customizing-agent-prompts-optional)
- [License](#license)

## Features

- **Dual-Mode Architecture**: Run as **API server** (HTTP endpoints) or **Worker** (background job processing) from the same codebase
- **JSON:API Compliance**: Full JSON:API specification support with serializers, pagination, and cursor-based navigation
- **Neo4j Integration**: Graph database operations with Cypher query builder
- **Redis Caching**: Built-in caching layer with configurable TTLs
- **Multi-Tenant Architecture**: Support for both B2B (multi-company) and B2C (single invisible company) scenarios
- **AI Agents**: LangChain-powered agents including GraphRAG and DRIFT for knowledge extraction, summarization, and intelligent responses
- **DRIFT Search**: Advanced semantic search using community detection and HyDE (Hypothetical Document Embedding)
- **OAuth 2.0 Server**: RFC 6749/7636 compliant authorization server with PKCE support
- **OpenAPI Documentation**: Auto-generated JSON:API compliant Swagger/Redoc documentation
- **Authentication**: JWT-based authentication with role-based access control
- **Background Jobs**: BullMQ integration for async job processing
- **WebSockets**: Real-time communication support
- **Vision LLM Support**: Separate configuration for vision/image analysis models
- **Transcriber Support**: Speech-to-text transcription capabilities
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
- Discord bot integration (when configured)
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

The mode is determined by the `--mode` flag and configured via `getAppMode()` and `getAppModeConfig()`.

## Architecture

The library is organized into five main layers:

```
@carlonicora/nestjs-neo4jsonapi
├── common/       # Shared utilities, abstracts, decorators, guards
├── config/       # Configuration system and tokens
├── core/         # Infrastructure modules (19 modules)
├── foundations/  # Domain/business modules (31 modules)
├── agents/       # AI agent modules (7 modules)
├── openapi/      # OpenAPI/Swagger documentation
└── bootstrap/    # Application bootstrap utilities
```

## Installation

```bash
pnpm add @carlonicora/nestjs-neo4jsonapi
```

### Git Submodule Setup (Alternative)

If you want to use the package as a git submodule (for development or before npm release):

**1. Add the submodule**

```bash
cd /path/to/your-project
git submodule add https://github.com/carlonicora/nestjs-neo4jsonapi packages/nestjs-neo4jsonapi
```

**2. Verify it worked**

```bash
git submodule status
# Should show: <commit-sha> packages/nestjs-neo4jsonapi (heads/master)
```

**3. Commit the submodule**

```bash
git add .gitmodules packages/nestjs-neo4jsonapi
git commit -m "Add nestjs-neo4jsonapi as submodule"
```

**4. Update your `package.json`** (e.g., `apps/api/package.json`)

```json
{
  "dependencies": {
    "@carlonicora/nestjs-neo4jsonapi": "workspace:*"
  }
}
```

**5. Ensure `pnpm-workspace.yaml` includes packages**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**6. Install and build**

```bash
pnpm install
cd packages/nestjs-neo4jsonapi && pnpm build && cd ../..
```

**For CI/CD (GitHub Actions)**, add `submodules: recursive` to your checkout step:

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
```

**Cloning a project with submodules:**

```bash
# When cloning fresh
git clone --recurse-submodules https://github.com/your/repo.git

# If already cloned
git submodule update --init --recursive
```

### Peer Dependencies

The following packages must be installed in your application:

```bash
pnpm add @nestjs/common @nestjs/core @nestjs/config @nestjs/event-emitter @nestjs/jwt @nestjs/passport @nestjs/platform-socket.io @nestjs/throttler @nestjs/websockets nestjs-cls zod
```

| Package      | Version | Purpose                      |
| ------------ | ------- | ---------------------------- |
| `nestjs-cls` | ^6.0.1  | Request-scoped context (CLS) |
| `zod`        | ^4.0.0  | Schema validation            |

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

# Auth
ALLOW_REGISTRATION=true

# OAuth 2.0 Server (optional)
OAUTH_ENABLED=false
OAUTH_AUTHORIZATION_CODE_LIFETIME=600
OAUTH_ACCESS_TOKEN_LIFETIME=3600
OAUTH_REFRESH_TOKEN_LIFETIME=604800
OAUTH_REQUIRE_PKCE_FOR_PUBLIC_CLIENTS=true
OAUTH_ROTATE_REFRESH_TOKENS=true

# CORS
CORS_ORIGINS=http://localhost:3001
CORS_CREDENTIALS=true
CORS_ORIGIN_PATTERNS=
CORS_METHODS=GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=
CORS_MAX_AGE=86400
CORS_PREFLIGHT_CONTINUE=false
CORS_OPTIONS_SUCCESS_STATUS=204
CORS_LOG_VIOLATIONS=true

# AI Configuration (optional)
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
AI_URL=
AI_REGION=
AI_INSTANCE=
AI_API_VERSION=
AI_INPUT_COST_PER_1M_TOKENS=0
AI_OUTPUT_COST_PER_1M_TOKENS=0
AI_GOOGLE_CREDENTIALS_BASE64=

# Vision LLM (optional - falls back to AI_ settings if not set)
VISION_PROVIDER=openai
VISION_API_KEY=
VISION_MODEL=gpt-4o
VISION_URL=
VISION_REGION=
VISION_SECRET=
VISION_INSTANCE=
VISION_API_VERSION=
VISION_INPUT_COST_PER_1M_TOKENS=0
VISION_OUTPUT_COST_PER_1M_TOKENS=0
VISION_GOOGLE_CREDENTIALS_BASE64=

# Transcriber (optional)
TRANSCRIBER_PROVIDER=
TRANSCRIBER_API_KEY=
TRANSCRIBER_MODEL=
TRANSCRIBER_URL=
TRANSCRIBER_API_VERSION=

# Embedder (optional)
EMBEDDER_PROVIDER=openrouter
EMBEDDER_API_KEY=sk-...
EMBEDDER_MODEL=openai/text-embedding-3-large
EMBEDDER_DIMENSIONS=3072
EMBEDDER_INSTANCE=
EMBEDDER_API_VERSION=
EMBEDDER_REGION=
EMBEDDER_GOOGLE_CREDENTIALS_BASE64=

# Logging - Loki (optional)
LOKI_ENABLED=false
LOKI_HOST=http://localhost:3100
LOKI_USERNAME=
LOKI_PASSWORD=
LOKI_BATCHING=true
LOKI_INTERVAL=30
LOKI_APP_LABEL=

# Tracing - Tempo (optional)
TEMPO_ENABLED=false
TEMPO_ENDPOINT=http://localhost:4318/v1/traces
TEMPO_SERVICE_NAME=my-app
TEMPO_SERVICE_VERSION=1.0.0

# S3 Storage (optional)
S3_TYPE=aws
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=eu-west-1

# Email (supports: sendgrid, smtp, brevo)
EMAIL_PROVIDER=sendgrid
EMAIL_API_KEY=
EMAIL_FROM=noreply@example.com
EMAIL_HOST=
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USERNAME=
EMAIL_PASSWORD=

# Stripe (optional)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_API_VERSION=2024-12-18.acacia
STRIPE_PORTAL_RETURN_URL=
STRIPE_PORTAL_CONFIGURATION_ID=

# Push Notifications (optional)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL=60000
RATE_LIMIT_REQUESTS=100
IP_RATE_LIMIT_REQUESTS=20

# Encryption
ENCRYPTION_KEY=your-32-char-encryption-key

# Discord (optional)
NEXT_PUBLIC_DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_TOKEN=
DISCORD_DEV_GUILD_ID=

# Google (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## Quick Start

The library provides a `bootstrap()` function that handles all the complexity of setting up a NestJS application. You only need to provide your app-specific configuration.

**What you need:**
1. `main.ts` - Bootstrap entry point (~25 lines)
2. `config/config.ts` - Optional custom config extending baseConfig
3. `features/features.modules.ts` - Your feature modules

**What the library handles internally:**
- AppModule creation (no `app.module.ts` needed)
- Fastify adapter with multipart support
- Global validation pipes, exception filters, and interceptors
- Rate limiting, CORS, and caching
- i18n internationalization
- OpenAPI/Swagger documentation
- Discord bot integration (Worker mode)
- Graceful shutdown handlers

### 1. Create Your Features Module

```typescript
// src/features/features.modules.ts
import { Module } from "@nestjs/common";
// Import your app-specific feature modules

@Module({
  imports: [
    // Your feature modules here
  ],
})
export class FeaturesModules {}
```

### 2. Create Configuration File (Optional)

If you need custom queues or content types, create a config file:

```typescript
// src/config/config.ts
import { baseConfig } from "@carlonicora/nestjs-neo4jsonapi";
import { QueueId } from "./enums/queue.id";

export default () => ({
  ...baseConfig,
  // Register queue IDs for background job processing
  chunkQueues: {
    queueIds: Object.values(QueueId),
  },
  // Register content type labels for multi-label Neo4j queries
  contentTypes: {
    types: ["Article", "Document", "Hyperlink"],
  },
});
```

### 3. Create OpenAPI Configuration (Optional)

```typescript
// src/openapi/openapi.config.ts
import { OpenApiOptions } from "@carlonicora/nestjs-neo4jsonapi";
import { allEntityDescriptors } from "./entity-registry";

export function getOpenApiConfig(): OpenApiOptions {
  const isDevelopment = process.env.NODE_ENV !== "production";

  return {
    enableSwagger: isDevelopment || process.env.ENABLE_SWAGGER === "true",
    swaggerPath: "/api-docs",
    enableRedoc: isDevelopment || process.env.ENABLE_REDOC === "true",
    redocPath: "/docs",
    entityDescriptors: [...allEntityDescriptors],
    title: "My API",
    description: "RESTful API following JSON:API specification",
    version: process.env.npm_package_version || "1.0.0",
    bearerAuth: true,
    contactEmail: "api@example.com",
    license: "Proprietary",
    licenseUrl: "https://example.com/terms",
  };
}
```

### 4. Bootstrap Your Application

```typescript
// src/main.ts
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables FIRST (before any library imports)
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { bootstrap } from "@carlonicora/nestjs-neo4jsonapi";
import config from "./config/config";
import { FeaturesModules } from "./features/features.modules";
import { getOpenApiConfig } from "./openapi/openapi.config";

bootstrap({
  appModules: [FeaturesModules],
  i18n: {
    fallbackLanguage: "en",
    path: path.join(__dirname, "i18n"),
  },
  config: config,
  contentExtension: {
    additionalRelationships: [],
  },
  openApi: getOpenApiConfig(),
});
```

That's it! The `bootstrap()` function handles everything else.

### Bootstrap Options

| Option             | Type                             | Required | Description                                                          |
| ------------------ | -------------------------------- | -------- | -------------------------------------------------------------------- |
| `appModules`       | `(Type<any> \| DynamicModule)[]` | Yes      | Your app-specific feature modules                                    |
| `i18n`             | `I18nOptions`                    | No       | i18n configuration (fallbackLanguage, path)                          |
| `config`           | `() => Record<string, any>`      | No       | Custom config that extends baseConfig (merged with library defaults) |
| `contentExtension` | `ContentExtensionOptions`        | No       | Additional relationships for Content module                          |
| `openApi`          | `OpenApiOptions`                 | No       | OpenAPI/Swagger documentation configuration                          |

### Configuration Options (via `config`)

The `config` function returns an object that is merged with `baseConfig`. Available options:

| Option                 | Type                                                                          | Description                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `chunkQueues.queueIds` | `string[]`                                                                    | Queue IDs for BullMQ registration (for background job processing)                              |
| `contentTypes.types`   | `string[]`                                                                    | Neo4j labels for content types (used in multi-label content queries)                           |
| `jobNames`             | `{ process: Record<string, string>, notifications?: Record<string, string> }` | Job names for BullMQ processors (maps content types to job names)                              |
| `prompts.*`            | Various                                                                       | Custom AI agent prompts (see [Customizing Agent Prompts](#customizing-agent-prompts-optional)) |

### What bootstrap() Handles Internally

The `bootstrap()` function creates a dynamic `AppModule` that includes:

- EventEmitterModule for async events
- AppModeModule (API vs Worker mode)
- ConfigModule with merged configuration
- ThrottlerModule for rate limiting
- ClsModule for request context
- I18nModule for internationalization
- ScheduleModule for cron jobs (Worker mode only)
- CoreModule (all infrastructure modules)
- FoundationsModule (all domain modules)
- AgentsModule (AI agents)
- OpenApiModule for documentation
- NecordModule + DiscordModule (Worker mode, when DISCORD_TOKEN is set)

> **Note:** For advanced customization scenarios, you can examine the bootstrap source code in `packages/nestjs-neo4jsonapi/src/bootstrap/`. However, the default `bootstrap()` function handles all common use cases.

---

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

  role?: Role[]; // User's roles within the company
  company?: Company; // The company this user belongs to
  module?: Module[]; // Modules assigned to this specific user
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
  monthlyTokens: number;
  oneOffTokens: number;

  feature: Feature[]; // Features available to company
  module: Module[]; // Modules available to company
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
    companyId, // Links to existing company
    roles: [AppRoles.Viewer], // UUID: "c3d4e5f6-a7b8-9012-cdef-123456789012"
  });
}

// Example: Create company admin
async function createCompanyAdmin(email: string, companyId: string) {
  const user = await userService.create({
    email,
    companyId,
    roles: [SystemRoles.CompanyAdministrator], // UUID from library
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
    name: `${email}'s workspace`, // Or generate a UUID
    ownerEmail: email,
  });

  // Create user linked to their personal company
  // They are the administrator of their own space
  const user = await userService.create({
    email,
    companyId: company.id,
    roles: [SystemRoles.CompanyAdministrator], // UUID - owner of personal space
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

| Benefit            | B2B               | B2C                              |
| ------------------ | ----------------- | -------------------------------- |
| Data isolation     | Per company       | Per user (via invisible company) |
| User collaboration | Yes               | No (single user)                 |
| Scalability        | Multi-tenant      | Same architecture                |
| Future B2B upgrade | Already supported | Easy migration path              |
| Billing            | Per company       | Per user (mapped to company)     |

## Required Configuration Files

### File Structure

```
your-app/
├── src/
│   ├── config/
│   │   ├── config.ts                 # App configuration (optional)
│   │   └── enums/
│   │       └── queue.id.ts           # Queue identifiers (if using jobs)
│   ├── features/                     # Your app-specific modules
│   │   └── features.modules.ts       # Imports all your feature modules
│   ├── openapi/                      # OpenAPI config (optional)
│   │   └── openapi.config.ts
│   └── main.ts                       # Bootstrap entry (~25 lines)
├── .env
└── package.json
```

**Note:** No `app.module.ts` is required - the library creates this dynamically via `createAppModule()`.

### Queue IDs and Job Names (if using background jobs)

Queue IDs must match the lowercase version of your content type `labelName`:

```typescript
// src/config/enums/queue.id.ts
export enum QueueId {
  CHUNK = "chunk", // Required - used by ChunkProcessor
  ARTICLE = "article", // For Article content type (labelName: "Article")
  DOCUMENT = "document", // For Document content type (labelName: "Document")
  // Add queue IDs for each content type (lowercase of labelName)
}
```

Job names map content types to processor job names:

```typescript
// src/config/enums/job.name.ts
export const JobName = {
  process: {
    chunk: "process_chunk", // Required - used by ChunkProcessor
    Article: "process_article", // Key = labelName, value = job name
    Document: "process_document",
  },
  notifications: {},
} as const;
```

**Convention**: After chunk processing completes, `ChunkService` automatically queues a job to `labelName.toLowerCase()` queue with job name from `jobNames.process[labelName]`.

## Core Modules

The library includes 19 core infrastructure modules:

| Module            | Description                                      |
| ----------------- | ------------------------------------------------ |
| `Neo4JModule`     | Neo4j graph database integration                 |
| `RedisModule`     | Redis client and messaging                       |
| `CacheModule`     | Distributed caching layer                        |
| `SecurityModule`  | JWT authentication and role-based access control |
| `JsonApiModule`   | JSON:API specification compliance                |
| `LoggingModule`   | Structured logging with Loki                     |
| `TracingModule`   | Distributed tracing with OpenTelemetry           |
| `EmailModule`     | Email service (SendGrid, SMTP, Brevo)            |
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
| `HealthModule`    | Health check endpoints for liveness/readiness    |

## Health Check Endpoints

The package includes built-in health check endpoints using `@nestjs/terminus` for container orchestration and load balancer integration. Rate limiting is automatically disabled for all health endpoints.

### Endpoints

| Endpoint            | Purpose            | Checks                 |
| ------------------- | ------------------ | ---------------------- |
| `GET /health`       | Full health status | Neo4j, Redis, S3, Disk |
| `GET /health/live`  | Liveness probe     | None (process running) |
| `GET /health/ready` | Readiness probe    | Neo4j, Redis           |

### Full Health Check: GET /health

Returns detailed status of all dependencies. Use for monitoring dashboards.

**Response when healthy (200 OK):**

```json
{
  "status": "ok",
  "info": {
    "neo4j": { "status": "up", "message": "Neo4j connection healthy" },
    "redis": { "status": "up", "message": "Redis connection healthy" },
    "storage": { "status": "up", "message": "aws storage connection healthy" },
    "disk": { "status": "up", "message": "Disk space healthy", "free": "50.00 GB" }
  },
  "error": {},
  "details": { ... }
}
```

### Liveness Probe: GET /health/live

Indicates if the application process is running. Does NOT check external dependencies.

**Use for Kubernetes livenessProbe:** If this fails, the container should be restarted.

**Response (200 OK):**

```json
{
  "status": "ok",
  "info": {},
  "error": {},
  "details": {}
}
```

### Readiness Probe: GET /health/ready

Indicates if the application can accept traffic. Checks critical dependencies (Neo4j, Redis).

**Use for Kubernetes readinessProbe:** If this fails, traffic should be routed elsewhere.

**Response when healthy (200 OK):**

```json
{
  "status": "ok",
  "info": {
    "neo4j": { "status": "up", "message": "Neo4j connection healthy" },
    "redis": { "status": "up", "message": "Redis connection healthy" }
  },
  "error": {},
  "details": { ... }
}
```

**Response when unhealthy (503 Service Unavailable):**

```json
{
  "status": "error",
  "info": {
    "redis": { "status": "up", "message": "Redis connection healthy" }
  },
  "error": {
    "neo4j": { "status": "down", "message": "Connection refused" }
  },
  "details": { ... }
}
```

### Kubernetes Configuration Example

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: api
      livenessProbe:
        httpGet:
          path: /health/live
          port: 3000
        initialDelaySeconds: 10
        periodSeconds: 10
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 5
```

### Health Indicators

The module includes four health indicators:

| Indicator              | Timeout | What it checks             |
| ---------------------- | ------- | -------------------------- |
| `Neo4jHealthIndicator` | 3s      | Executes `RETURN 1` query  |
| `RedisHealthIndicator` | 3s      | Connection status + PING   |
| `S3HealthIndicator`    | 5s      | Bucket access (HeadBucket) |
| `DiskHealthIndicator`  | -       | Free space >= 1GB or 10%    |

## Foundation Modules

The library includes 31 foundation modules for business domain logic:

| Module                     | Description                                        |
| -------------------------- | -------------------------------------------------- |
| `UserModule`               | User management with CRUD operations               |
| `CompanyModule`            | Multi-tenant company management with deletion      |
| `AuthModule`               | Authentication (login, register, password reset)   |
| `RoleModule`               | Role management                                    |
| `OAuthModule`              | OAuth 2.0 Authorization Server (RFC 6749/7636)     |
| `ChunkModule`              | Document chunk storage and retrieval               |
| `ChunkerModule`            | Document parsing (PDF, DOCX, XLSX, HTML, PPTX)     |
| `AtomicFactModule`         | Atomic facts management for knowledge graphs       |
| `KeyConceptModule`         | Key concepts for knowledge graphs                  |
| `CommunityModule`          | Knowledge graph community storage                  |
| `ContentModule`            | Content management with extension support          |
| `NotificationModule`       | User notifications                                 |
| `PushModule`               | Push notifications (VAPID)                         |
| `FeatureModule`            | Feature flag management                            |
| `ModuleModule`             | Module/plugin management                           |
| `S3Module`                 | S3-compatible storage                              |
| `TokenUsageModule`         | AI token usage tracking                            |
| `AuditModule`              | Audit logging                                      |
| `RelevancyModule`          | Relevancy scoring                                  |
| `DiscordModule`            | Discord bot integration                            |
| `DiscordUserModule`        | Discord user management                            |
| `GoogleUserModule`         | Google OAuth user management                       |
| **Stripe Sub-modules:**    |                                                    |
| `StripeModule`             | Core Stripe integration                            |
| `StripeCustomerModule`     | Stripe customer management                         |
| `StripeSubscriptionModule` | Subscription lifecycle management                  |
| `StripeProductModule`      | Product management                                 |
| `StripePriceModule`        | Price/plan management with feature selection       |
| `StripeInvoiceModule`      | Invoice management                                 |
| `StripeUsageModule`        | Usage-based billing                                |
| `StripeWebhookModule`      | Webhook processing via BullMQ                      |
| `StripeTrialModule`        | Trial period management with email notifications   |

## AI Agents

The library includes 7 LangChain-powered agent modules for intelligent document processing:

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

### CommunityDetectorModule

Detects and creates communities from knowledge graph structure.

```typescript
import { CommunityDetectorService } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class MyService {
  constructor(private readonly communityDetector: CommunityDetectorService) {}

  async detectCommunities() {
    return this.communityDetector.detect();
  }
}
```

### CommunitySummariserModule

Generates summaries for detected communities.

```typescript
import { CommunitySummariserService } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class MyService {
  constructor(private readonly summariser: CommunitySummariserService) {}

  async summarizeCommunity(communityId: string) {
    return this.summariser.summarize({ communityId });
  }
}
```

### DriftModule

See [DRIFT Module (Advanced Semantic Search)](#drift-module-advanced-semantic-search) for detailed documentation.

## DRIFT Module (Advanced Semantic Search)

DRIFT (Dynamic Retrieval with Intelligence and Future-aware Thinking) is an advanced semantic search system that uses community detection and HyDE (Hypothetical Document Embedding) for sophisticated query understanding.

### Architecture

DRIFT uses a multi-node workflow:

| Node                         | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `HydeNodeService`            | Generates hypothetical document embedding     |
| `CommunitySearchNodeService` | Vector search against community summaries     |
| `PrimerAnswerNodeService`    | Generates initial answer + follow-up questions|
| `FollowUpNodeService`        | Processes follow-up questions iteratively     |
| `SynthesisNodeService`       | Combines all answers into final response      |

### Usage

```typescript
import { DriftSearchService } from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class MyService {
  constructor(private readonly driftSearch: DriftSearchService) {}

  async searchWithDrift(question: string) {
    // Full DRIFT workflow: HyDE -> Community Search -> Primer Answer -> Follow-ups -> Synthesis
    const result = await this.driftSearch.search({
      question,
      config: {
        primerTopK: 5,      // Top K communities to search
        followUpDepth: 2,   // Depth of follow-up question iterations
      },
    });

    // result contains:
    // - answer: Final synthesized answer
    // - matchedCommunities: Communities that matched the query
    // - followUpAnswers: Answers from follow-up questions
    // - initialAnswer: Initial answer before follow-ups
    // - confidence: Confidence score
    // - hydeEmbedding: Generated hypothetical document embedding
    return result;
  }

  async quickSearch(question: string) {
    // Quick search without follow-ups (HyDE + Community Search + Primer only)
    return this.driftSearch.quickSearch({ question, topK: 5 });
  }
}
```

### How DRIFT Works

1. **HyDE Generation**: Creates a hypothetical document that would answer the question
2. **Community Search**: Uses the HyDE embedding to find relevant communities
3. **Primer Answer**: Generates an initial answer and identifies follow-up questions
4. **Follow-up Processing**: Recursively explores follow-up questions for deeper context
5. **Synthesis**: Combines all gathered information into a comprehensive final answer

## OpenAPI Documentation

The library includes comprehensive OpenAPI/Swagger documentation support with JSON:API compliance.

### Configuration

Enable OpenAPI in your bootstrap options:

```typescript
import { bootstrap } from "@carlonicora/nestjs-neo4jsonapi";

bootstrap({
  appModules: [FeaturesModules],
  openApi: {
    enableSwagger: true,
    swaggerPath: '/api-docs',
    enableRedoc: true,
    redocPath: '/docs',
    title: 'My API',
    description: 'RESTful API following JSON:API specification',
    version: '1.0.0',
    bearerAuth: true,
    contactEmail: 'api@example.com',
    license: 'Proprietary',
    licenseUrl: 'https://example.com/terms',
    entityDescriptors: [
      PhotographDescriptor,
      RollDescriptor,
      // ... your entity descriptors
    ],
  },
});
```

### OpenAPI Options

| Option              | Type    | Default      | Description                            |
| ------------------- | ------- | ------------ | -------------------------------------- |
| `enableSwagger`     | boolean | false        | Enable Swagger UI endpoint             |
| `swaggerPath`       | string  | '/api-docs'  | Path for Swagger UI                    |
| `enableRedoc`       | boolean | false        | Enable Redoc endpoint                  |
| `redocPath`         | string  | '/docs'      | Path for Redoc                         |
| `title`             | string  | -            | API documentation title                |
| `description`       | string  | -            | API description (supports markdown)    |
| `version`           | string  | -            | API version                            |
| `bearerAuth`        | boolean | true         | Enable JWT Bearer auth in docs         |
| `contactEmail`      | string  | -            | Contact email                          |
| `license`           | string  | -            | License name                           |
| `licenseUrl`        | string  | -            | License URL                            |
| `entityDescriptors` | array   | []           | Entity descriptors for schema generation |

### JSON:API Decorators

```typescript
import {
  ApiJsonApiResponse,
  ApiJsonApiListQuery,
  ApiJsonApiListErrors,
  ApiJsonApiCreateErrors,
  ApiJsonApiDeleteErrors,
} from "@carlonicora/nestjs-neo4jsonapi";

@Controller('photographs')
export class PhotographController {
  @Get(':id')
  @ApiJsonApiResponse(PhotographDescriptor)
  async findById() { ... }

  @Get()
  @ApiJsonApiResponse(PhotographDescriptor, { isList: true })
  @ApiJsonApiListQuery()
  @ApiJsonApiListErrors()
  async findAll() { ... }

  @Post()
  @ApiJsonApiResponse(PhotographDescriptor, { status: 201 })
  @ApiJsonApiCreateErrors()
  async create() { ... }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiJsonApiDeleteErrors()
  async delete() { ... }
}
```

## OAuth 2.0 Support

The library implements a complete OAuth 2.0 Authorization Server following RFC 6749 and RFC 7636 (PKCE).

### Enabling OAuth

```env
OAUTH_ENABLED=true
OAUTH_AUTHORIZATION_CODE_LIFETIME=600
OAUTH_ACCESS_TOKEN_LIFETIME=3600
OAUTH_REFRESH_TOKEN_LIFETIME=604800
OAUTH_REQUIRE_PKCE_FOR_PUBLIC_CLIENTS=true
OAUTH_ROTATE_REFRESH_TOKENS=true
```

### OAuth Endpoints

| Endpoint            | Method | Purpose                        |
| ------------------- | ------ | ------------------------------ |
| `/oauth/authorize`  | GET    | Authorization endpoint         |
| `/oauth/token`      | POST   | Token endpoint                 |
| `/oauth/revoke`     | POST   | Token revocation (RFC 7009)    |
| `/oauth/introspect` | POST   | Token introspection (RFC 7662) |
| `/oauth/clients`    | CRUD   | Client management              |

### Protecting Endpoints with OAuth

```typescript
import {
  JwtOrOAuthGuard,
  OAuthScopes,
} from "@carlonicora/nestjs-neo4jsonapi";

@Controller('photographs')
export class PhotographController {
  // Accepts both JWT and OAuth tokens (migration path)
  @Get(':id')
  @UseGuards(JwtOrOAuthGuard)
  @OAuthScopes('photographs:read')
  async findById() { ... }

  @Post()
  @UseGuards(JwtOrOAuthGuard)
  @OAuthScopes('photographs:read', 'photographs:write')
  async create() { ... }
}
```

### Context Set by OAuth

When using OAuth guards, the following context is set in CLS:

```typescript
// In your service
const userId = this.cls.get('userId');
const companyId = this.cls.get('companyId');
const clientId = this.cls.get('oauthClientId');
const scopes = this.cls.get('oauthScopes');
const authType = this.cls.get('authType'); // 'oauth' or 'jwt'
```

## Security & Authentication

### Available Guards

| Guard                | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `JwtAuthGuard`       | Requires valid JWT token                     |
| `AdminJwtAuthGuard`  | Requires Administrator role                  |
| `OptionalJwtAuthGuard` | JWT optional (works for anonymous users)   |
| `JwtOrOAuthGuard`    | Accepts OAuth first, falls back to JWT       |

### Using Guards

```typescript
import { Controller, Get, UseGuards } from "@nestjs/common";
import {
  JwtAuthGuard,
  AdminJwtAuthGuard,
  OptionalJwtAuthGuard,
  JwtOrOAuthGuard,
  Roles,
  OAuthScopes,
  SystemRoles
} from "@carlonicora/nestjs-neo4jsonapi";
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

  // Accepts both JWT and OAuth tokens
  @Get("oauth-or-jwt")
  @UseGuards(JwtOrOAuthGuard)
  @OAuthScopes('resources:read')
  async getResourcesWithOAuth() { ... }

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

@Injectable()
export class MyService {
  constructor(private readonly cls: ClsService) {}

  async doSomething() {
    // Access current user/company context
    const userId = this.cls.get("userId");
    const companyId = this.cls.get("companyId");
    const roles = this.cls.get("roles");
    const language = this.cls.get("language");

    // OAuth-specific context (when using OAuth)
    const authType = this.cls.get("authType"); // 'oauth' or 'jwt'
    const oauthScopes = this.cls.get("oauthScopes");

    if (config?.hasModule("premium-feature")) {
      // User's company has access to premium feature
    }
  }
}
```

## Company Deletion Handler

The library supports custom company deletion handlers for application-specific cleanup.

### Interface

```typescript
import {
  CompanyDeletionHandler,
  COMPANY_DELETION_HANDLER,
  DeletionReason,
  DeletionOptions
} from "@carlonicora/nestjs-neo4jsonapi";

type DeletionReason = 'trial_expired' | 'subscription_cancelled' | 'immediate_deletion';

interface DeletionOptions {
  sendEmail?: boolean;
  reason?: DeletionReason;
}

interface CompanyDeletionHandler {
  deleteCompany(companyId: string, companyName: string, options?: DeletionOptions): Promise<void>;
}
```

### Implementation

```typescript
import { Injectable } from "@nestjs/common";
import {
  CompanyDeletionHandler,
  DeletionOptions,
  S3Service,
} from "@carlonicora/nestjs-neo4jsonapi";

@Injectable()
export class CompanyDeletionService implements CompanyDeletionHandler {
  constructor(
    private readonly s3: S3Service,
    private readonly auditLogger: AuditLogger,
  ) {}

  async deleteCompany(companyId: string, companyName: string, options?: DeletionOptions) {
    // 1. Delete S3 objects
    await this.s3.deleteCompanyObjects(companyId);

    // 2. Log audit event
    await this.auditLogger.log({
      action: 'company_deleted',
      companyId,
      companyName,
      reason: options?.reason,
    });

    // 3. Send notification email if requested
    if (options?.sendEmail) {
      await this.sendDeletionEmail(companyName, options.reason);
    }
  }
}
```

### Registration

```typescript
import { Module, Global } from "@nestjs/common";
import { COMPANY_DELETION_HANDLER } from "@carlonicora/nestjs-neo4jsonapi";

@Global()
@Module({
  providers: [
    CompanyDeletionService,
    {
      provide: COMPANY_DELETION_HANDLER,
      useExisting: CompanyDeletionService,
    },
  ],
  exports: [CompanyDeletionService, COMPANY_DELETION_HANDLER],
})
export class CompanyDeletionModule {}
```

## Entity Descriptors (defineEntity)

Entity Descriptors provide a single source of truth for entity configuration, auto-generating mappers, serializers, constraints, and indexes.

### Basic Usage

```typescript
import { defineEntity, Entity, S3Service } from "@carlonicora/nestjs-neo4jsonapi";
import { rollMeta, companyMeta } from "@carlonicora/nestjs-neo4jsonapi";

// 1. Define entity type
export type Photograph = Entity & {
  url: string;
  filename?: string;
  stars: number;
  roll: Roll;
  company: Company;
};

// 2. Create entity descriptor
export const PhotographDescriptor = defineEntity<Photograph>()({
  // Meta (replaces .meta.ts file)
  type: "photographs",
  endpoint: "photographs",
  nodeName: "photograph",
  labelName: "Photograph",

  // Inject services for field transformers
  injectServices: [S3Service],

  // Field definitions
  fields: {
    url: {
      type: "string",
      required: true,
      transform: async (data, services) => {
        return await services.S3Service.generateSignedUrl({ key: data.url });
      },
    },
    filename: { type: "string" },
    stars: { type: "number", default: 0 },
  },

  // Computed fields (from Neo4j record)
  computed: {
    position: {
      compute: (params) => params.record.get("position"),
      meta: true, // Goes to JSON:API meta
    },
  },

  // Relationships
  relationships: {
    roll: {
      model: rollMeta,
      direction: "out",
      relationship: "FRAME_OF",
      cardinality: "one",
      dtoKey: "roll",
      fields: [{ name: "position", type: "number", required: true }],
    },
    company: {
      model: companyMeta,
      direction: "out",
      relationship: "BELONGS_TO",
      cardinality: "one",
    },
  },
});
```

### Field Types

| Type       | Neo4j/Cypher    | JSON     |
| ---------- | --------------- | -------- |
| `string`   | STRING          | string   |
| `number`   | INTEGER/FLOAT   | number   |
| `boolean`  | BOOLEAN         | boolean  |
| `date`     | DATE            | string (ISO) |
| `datetime` | DATETIME        | string (ISO) |
| `json`     | MAP             | object   |
| `string[]` | LIST\<STRING\>  | string[] |
| `number[]` | LIST\<INTEGER\> | number[] |

### Field Options

| Option      | Type     | Description                        |
| ----------- | -------- | ---------------------------------- |
| `type`      | CypherType | Data type                        |
| `required`  | boolean  | Required field                     |
| `default`   | any      | Default value                      |
| `meta`      | boolean  | Put in JSON:API meta               |
| `transform` | function | Async transform for serialization  |

### Relationship Options

| Option        | Type              | Description                       |
| ------------- | ----------------- | --------------------------------- |
| `model`       | DataMeta          | Related entity metadata           |
| `direction`   | 'in' \| 'out'     | Relationship direction            |
| `relationship`| string            | Neo4j relationship type           |
| `cardinality` | 'one' \| 'many'   | Single or collection              |
| `required`    | boolean           | Use MATCH vs OPTIONAL MATCH       |
| `contextKey`  | string            | CLS context key for value         |
| `dtoKey`      | string            | Override key in DTO               |
| `fields`      | array             | Edge properties                   |

### What defineEntity Auto-Generates

- **Constraints**: Unique constraint on `id`
- **Indexes**: FULLTEXT index on all string fields
- **Mapper**: Entity-to-record mapping
- **Serializer**: JSON:API compliant serialization

## Customizing Agent Prompts (Optional)

The library includes default prompts. Customization is entirely optional.

### Available Prompts

| Agent                  | Config Key                                    | Purpose                               |
| ---------------------- | --------------------------------------------- | ------------------------------------- |
| **GraphCreator**       | `prompts.graphCreator`                        | Extract atomic facts and key concepts |
| **Contextualiser**     | `prompts.contextualiser.questionRefiner`      | Refine user questions                 |
| **Contextualiser**     | `prompts.contextualiser.rationalPlan`         | Create rational plans                 |
| **Contextualiser**     | `prompts.contextualiser.keyConceptExtractor`  | Score key concepts                    |
| **Contextualiser**     | `prompts.contextualiser.atomicFactsExtractor` | Evaluate atomic facts                 |
| **Contextualiser**     | `prompts.contextualiser.chunk`                | Assess text chunks                    |
| **Contextualiser**     | `prompts.contextualiser.chunkVector`          | Vector-based chunk retrieval          |
| **Responder**          | `prompts.responder`                           | Generate final answers                |
| **Summariser**         | `prompts.summariser.map`                      | Summarize individual chunks           |
| **Summariser**         | `prompts.summariser.combine`                  | Combine summaries                     |
| **Summariser**         | `prompts.summariser.tldr`                     | Create TLDR                           |
| **CommunityDetector**  | `prompts.communityDetector`                   | Community detection                   |
| **CommunitySummariser**| `prompts.communitySummariser`                 | Community summarization               |
| **DRIFT**              | `prompts.drift.hyde`                          | HyDE generation                       |
| **DRIFT**              | `prompts.drift.primerAnswer`                  | Initial answer generation             |
| **DRIFT**              | `prompts.drift.followUp`                      | Follow-up question handling           |
| **DRIFT**              | `prompts.drift.synthesis`                     | Final answer synthesis                |

### Custom Prompts Example

Prompts are configured via `createBaseConfig()`:

```typescript
// src/config/config.ts
import { createBaseConfig } from "@carlonicora/nestjs-neo4jsonapi";

export const config = createBaseConfig({
  appName: "my-app",
  prompts: {
    graphCreator: "Your custom graph creator prompt...",
    contextualiser: {
      questionRefiner: "Your custom question refiner prompt...",
      rationalPlan: "Your custom rational plan prompt...",
    },
    summariser: {
      map: "Your custom map prompt...",
    },
  },
});
```

Or extend baseConfig via `BootstrapOptions.config`:

```typescript
// src/main.ts
bootstrap({
  // ... other options
  config: () => ({
    prompts: {
      graphCreator: "Your custom graph creator prompt...",
    },
  }),
});
```

## License

This project is licensed under GPL v3 for open source use.

For commercial/closed-source licensing, contact: [@carlonicora](https://github.com/carlonicora)

## Author

Carlo Nicora - [@carlonicora](https://github.com/carlonicora)
