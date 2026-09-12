import { CatalogEntity, CatalogRelationship } from "../interfaces/graph.catalog.interface";

/**
 * One place decides what a `chat.writable` entity exposes to the assistant, so
 * `describe_entity` (which TELLS the model what it may write) and the operator's
 * write tools (which REFUSE everything else) can never drift apart.
 *
 * Two declaration forms are compiled into the catalog:
 * - legacy `chat.writable: true` — `writableFields` / `writableRelationships` are
 *   `undefined`, meaning "every described field, every forward non-polymorphic
 *   relationship except the scope one";
 * - `ChatWritableConfig` — the allow-lists, with an omitted `relationships`
 *   compiled to `[]` (none).
 */

/**
 * The relationship that pins a record to the run's scope root. Writable types are
 * exactly one hop from their root — the catalog rejects deeper ones at boot — so
 * the first hop's key is that relationship.
 */
export const scopeKeyOf = (entity: CatalogEntity): string | undefined => entity.scope?.path[0]?.key;

/** Every field name the assistant may write on this entity, in declaration order. */
export const writableFieldNames = (entity: CatalogEntity): string[] =>
  entity.writableFields ? [...entity.writableFields] : entity.fields.map((field) => field.name);

export const isFieldWritable = (entity: CatalogEntity, name: string): boolean =>
  !entity.writableFields || entity.writableFields.includes(name);

/**
 * Why the generic write path must never touch a relationship:
 * - `reverse`: serialisation-only, with no edge on this side;
 * - `polymorphic`: a read-only chat traversal carrying no single target type
 *   (`targetType` is the `"*"` placeholder, which no scope check can honour);
 * - `scope`: re-pointing it would move the record into another scope root;
 * - `notListed`: the descriptor's `chat.writable.relationships` omits it.
 */
export type RelationshipRejection = "reverse" | "polymorphic" | "scope" | "notListed";

/** The reason this relationship may not be written, or `null` when it may. */
export const relationshipRejection = (
  entity: CatalogEntity,
  relationship: CatalogRelationship,
): RelationshipRejection | null => {
  if (relationship.isReverse) return "reverse";
  if (relationship.polymorphic) return "polymorphic";
  if (relationship.name === scopeKeyOf(entity)) return "scope";
  if (entity.writableRelationships && !entity.writableRelationships.includes(relationship.name)) return "notListed";
  return null;
};

export const isRelationshipWritable = (entity: CatalogEntity, relationship: CatalogRelationship): boolean =>
  relationshipRejection(entity, relationship) === null;

/** Every relationship name the assistant may write on this entity, in catalog order. */
export const writableRelationshipNames = (entity: CatalogEntity): string[] =>
  entity.relationships.filter((relationship) => isRelationshipWritable(entity, relationship)).map((r) => r.name);
