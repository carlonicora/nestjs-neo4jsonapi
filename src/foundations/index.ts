/**
 * Foundation modules - domain-specific business logic modules
 */

// Centralized FoundationsModule - import all foundation modules with single forRoot()
export * from "./foundations.modules";

// Individual foundation modules with entities, metas, repositories, and services
export * from "./atomicfact";
export * from "./audit";
export * from "./auth";
export * from "./chunk";
export * from "./chunker";
export * from "./company";
export * from "./content";
export * from "./discord";
export * from "./discord-user";
export * from "./feature";
export * from "./keyconcept";
export * from "./module";
export * from "./notification";
export * from "./oauth";
export * from "./push";
export * from "./referral";
export * from "./relevancy";
export * from "./role";
export * from "./s3";
export * from "./stripe";
export * from "./tokenusage";
export * from "./two-factor";
export * from "./user";
