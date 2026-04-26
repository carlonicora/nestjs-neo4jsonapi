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
}
