import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";

/**
 * Edge-only lookup behind the polymorphic "related" traversal.
 *
 * This is a graph-tool-layer query, not a repository: it returns nothing but
 * node ids and labels, and every id it yields is re-fetched afterwards through
 * that type's own company-scoped service read (`AbstractService.findRecordById`
 * → `buildDefaultMatch()`), which is where tenancy is enforced. The traverse
 * tool also verifies the SOURCE record through the same company-scoped read
 * before this service is consulted at all, so the walk starts from a node the
 * caller is already entitled to see.
 */
@Injectable()
export class RelatedEdgesService {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Ids and labels of every node linked to `id` by `cypherLabel`, in EITHER
   * direction — a link recorded one way (a GM-drawn link) and the same pair
   * recorded the other way (a mention) are the same relationship to the model.
   * `DISTINCT` collapses a pair linked both ways into one row.
   *
   * `labelName` and `cypherLabel` are interpolated because Cypher cannot
   * parameterise a node label or a relationship type. Neither value is ever
   * user-controlled: both come from the compiled catalog
   * (`CatalogEntity.labelName` / `CatalogRelationship.cypherLabel`), never from
   * tool input. `id` and `limit` are real query parameters, and the
   * hand-written LIMIT casts with `toInteger($limit)` because a JS number
   * reaches the driver as a float ("11.0") and Cypher rejects it.
   */
  async findRelatedIds(params: {
    labelName: string;
    id: string;
    cypherLabel: string;
    limit: number;
  }): Promise<{ id: string; label: string }[]> {
    const result = await this.neo4j.read(
      `
      MATCH (source:${params.labelName} { id: $id })-[:${params.cypherLabel}]-(x)
      RETURN DISTINCT x.id AS id, labels(x)[0] AS label
      LIMIT toInteger($limit)
      `,
      { id: params.id, limit: params.limit },
    );

    return (((result as any)?.records ?? []) as any[]).map((record) => ({
      id: record.get("id"),
      label: record.get("label"),
    }));
  }
}
