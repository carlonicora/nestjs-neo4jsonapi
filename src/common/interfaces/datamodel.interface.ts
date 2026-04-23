import { AbstractJsonApiSerialiser } from "../../core/jsonapi/abstracts/abstract.jsonapi.serialiser";
import { JsonApiServiceInterface } from "../../core/jsonapi/interfaces/jsonapi.service.interface";
import { PolymorphicConfig } from "./entity.schema.interface";

export function getEndpoint(modelGetter: () => DataModelInterface<any>): string {
  return modelGetter().endpoint;
}

export type SerialiserType = AbstractJsonApiSerialiser & JsonApiServiceInterface;

export type DataMeta = {
  type: string;
  endpoint: string;
  nodeName: string;
  labelName: string;
};

/**
 * Relationship info for proper self-referential relationship support.
 * Tracks both the model's nodeName (for registry lookup) and the
 * relationship name (for Cypher column matching and property assignment).
 *
 * For polymorphic relationships whose targets span multiple Neo4j labels
 * (i.e. polymorphic WITHOUT `discriminatorRelationship`), `polymorphic`
 * carries the config so the entity factory can resolve the correct model
 * per row via the discriminator. For same-label polymorphism (phlow's
 * taxonomy case, with `discriminatorRelationship`) this field is still
 * populated, but the entity factory's existing single-mapper path applies
 * because all candidates share the same Neo4j shape.
 */
export type RelationshipInfo = {
  nodeName: string; // Model's nodeName for looking up in registry
  relationshipName: string; // Property name on entity (for Cypher column and assignment)
  polymorphic?: PolymorphicConfig;
};

export type DataModelInterface<T> = DataMeta & {
  entity: T;
  mapper: (params: { data: any; record: any; entityFactory: any; name?: string }) => T;
  serialiser?: new (...args: any[]) => SerialiserType;
  childrenTokens?: string[];
  singleChildrenTokens?: string[];
  dynamicChildrenPatterns?: string[];
  dynamicSingleChildrenPatterns?: string[];
  // New: full relationship info for proper self-referential support
  childrenRelationships?: RelationshipInfo[];
  singleChildrenRelationships?: RelationshipInfo[];
};
