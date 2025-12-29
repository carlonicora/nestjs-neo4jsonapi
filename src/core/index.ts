/**
 * Core module exports
 *
 * Contains infrastructure modules: neo4j, redis, cache, jsonapi, logging,
 * email, queue, stripe, tracing, websocket, security, cors, version,
 * llm, blocknote, migrator, appmode, debug.
 *
 * Note: Some exports are selective to avoid duplicate type/interface exports:
 * - TracingContext is exported only from tracing module
 * - JsonApiCursorInterface is exported only from jsonapi module
 */

// Centralized CoreModule - import all core modules with single forRootAsync()
export * from "./core.module";

// Core infrastructure modules
export * from "./neo4j";
export * from "./redis";
export * from "./cache";
export * from "./security";
export * from "./appmode";
export * from "./email";
export * from "./queue";
export * from "./cors";
export * from "./version";
export * from "./websocket";
export * from "./llm";
export * from "./blocknote";
export * from "./migrator";
export * from "./debug";

// JSON:API module (exports JsonApiCursorInterface)
export * from "./jsonapi";

// Tracing module (exports TracingContext)
export * from "./tracing";

// Logging module (exports TracingServiceInterface but not TracingContext to avoid duplicates)
export * from "./logging";
