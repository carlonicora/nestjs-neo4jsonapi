/**
 * @carlonicora/nestjs-neo4jsonapi
 *
 * NestJS foundation package with JSON:API, Neo4j, Redis, and common utilities.
 */

// Common exports
export * from "./common";

// Config exports
export * from "./config";

// Core module exports
export * from "./core";
export * from "./core/pdf";
export * from "./core/document";

// Foundation module exports
export * from "./foundations";

// Agent module exports
export * from "./agents";

// Bootstrap utilities
export * from "./bootstrap";

// OpenAPI module exports
export * from "./openapi";

// RedisLockService is not re-exported by core/redis/index.ts, so export explicitly here.
export { RedisLockService } from "./core/redis/services/redis.lock.service";
