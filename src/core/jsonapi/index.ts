/**
 * JSON:API module exports
 *
 * Provides JSON:API specification compliant serialization with support for
 * resources, relationships, pagination, sparse fieldsets, and included resources.
 */

// Module
export * from "./jsonapi.module";

// Services
export * from "./services/jsonapi.service";

// Factories
export { JsonApiSerialiserFactory } from "./factories/jsonapi.serialiser.factory";
export { DynamicRelationshipFactory } from "./factories/dynamic.relationship.factory";

// Abstracts
export * from "./abstracts/abstract.jsonapi.serialiser";

// Serialisers
export * from "./serialisers/jsonapi.paginator";
export * from "./serialisers/descriptor.based.serialiser";

// Interfaces
export * from "./interfaces/jsonapi.service.interface";
export * from "./interfaces/jsonapi.data.interface";
export * from "./interfaces/jsonapi.document.interface";
export * from "./interfaces/jsonapi.pagination.interface";
export * from "./interfaces/jsonapi.cursor.interface";
export * from "./interfaces/jsonapi.relationship.builder.interface";

// Types
export * from "./types/JsonApiIncludedFields";
