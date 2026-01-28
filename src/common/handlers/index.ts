/**
 * Handler factories for reducing controller boilerplate
 *
 * These factories create reusable handler functions that controllers
 * can delegate to from their decorated methods.
 */

export { createCrudHandlers, ListQueryParams } from "./crud.handlers";
export { createRelationshipHandlers, RelatedQueryParams } from "./relationship.handlers";
