import { FieldKind } from "../../../common/interfaces/entity.schema.interface";

export interface CatalogField {
  name: string;
  /** Cypher scalar / array type string from the Descriptor. */
  type: string;
  description: string;
  /** Whether filter operators apply to this field. */
  filterable: boolean;
  /** Whether sort may reference this field. */
  sortable: boolean;
  /**
   * Semantic kind propagated from the descriptor. When present, the catalogue
   * renderer emits an inline marker and the tool layer emits a companion
   * formatted value alongside the raw scalar.
   */
  kind?: FieldKind;
}

export interface CatalogRelationship {
  /** Traversal name exposed to the LLM. */
  name: string;
  sourceType: string;
  targetType: string;
  cardinality: "one" | "many";
  description: string;
  /** Internal: used by tool layer to build the Cypher MATCH; never exposed to the LLM. */
  cypherDirection: "out" | "in";
  cypherLabel: string;
  /** Internal: true if this relationship was materialised from a sibling's reverse: {} block. */
  isReverse: boolean;
  /** For reverse relationships only: the descriptor key on the target side
   *  (i.e. the forward relationship name on the target's own descriptor).
   *  Used by the traverse tool to pass the correct lookup key to
   *  AbstractRepository.findByRelated, which keys relationships by descriptor name. */
  inverseKey?: string;
  /**
   * Internal: true when the traversal is polymorphic — it has no single target
   * type (`targetType` is `"*"`) and its results carry their own type. Compiled
   * from `chat.related`; never declared on a descriptor relationship.
   */
  polymorphic?: true;
}

export interface CatalogScopeHop {
  /** Descriptor relationship key on the SOURCE type of this hop. */
  key: string;
  /** Neo4j relationship type, e.g. "PART_OF". */
  cypherLabel: string;
  /** Direction from the SOURCE node's perspective. */
  cypherDirection: "out" | "in";
  /** Neo4j label of this hop's target, e.g. "Campaign". */
  targetLabel: string;
  /** JSON:API type of this hop's target, e.g. "campaigns". */
  targetType: string;
}

export interface CatalogScope {
  /** Ordered hops from this entity to the scope root. Empty when this entity IS the root. */
  path: CatalogScopeHop[];
  /** JSON:API type of the scope root, e.g. "campaigns". */
  rootType: string;
  /** Neo4j label of the scope root, e.g. "Campaign". */
  rootLabel: string;
}

export interface CatalogEntity {
  type: string;
  /** Stable module UUID — matches the `(Module) {id}` node in Neo4j. */
  moduleId: string;
  description: string;
  fields: CatalogField[];
  relationships: CatalogRelationship[];
  summary?: (data: any) => string;
  textSearchFields?: string[];
  /** Neo4j node name / alias for tool-layer query construction. */
  nodeName: string;
  /** Neo4j label name for tool-layer query construction. */
  labelName: string;
  /** When set, the tool layer auto-materialises these relationships one hop on every read. */
  bridge?: { materialiseTo: string[] };
  /** Compiled scope chain. Absent when the descriptor declares no chat.scope. */
  scope?: CatalogScope;
  /** Mirrors chat.writable. */
  writable?: boolean;
  /** Mirrors chat.list — stage-1 field names for list-returning tools. */
  list?: string[];
}
