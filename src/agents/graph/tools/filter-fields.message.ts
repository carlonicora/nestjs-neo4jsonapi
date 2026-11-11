import type { CatalogEntity } from "../interfaces/graph.catalog.interface";
import type { ExternalFilterCapability } from "../../../common/interfaces/external.entity.source.interface";
import { describeCatalogEntity } from "./describe-entity.tool";

/**
 * The filterable and sortable fields of a type, for a filter error.
 *
 * Lists only the fields that accept at least one operator, each as
 * `field (op, op…)`, then the sortable fields on their own line. The operators
 * are the ones `describe_entity` advertises (`describeCatalogEntity`), so the
 * error and the description never disagree.
 *
 * @param entity - The catalog type the filter targets.
 * @param capabilities - The filter capabilities of the type's service
 *   (`serviceFilterCapabilities`), `undefined` when it declares none.
 * @returns e.g. `Valid filter fields for judgements: name (eq, like), decisionDate (gte, lte).\nSortable fields: name, decisionDate.`
 */
export function filterFieldsMessage(
  entity: CatalogEntity,
  capabilities: ExternalFilterCapability[] | undefined,
): string {
  const { fields } = describeCatalogEntity(entity, capabilities);
  const filterable = fields
    .filter((f) => f.operators.length > 0)
    .map((f) => `${f.name} (${f.operators.join(", ")})`)
    .join(", ");
  const sortable = fields
    .filter((f) => f.sortable)
    .map((f) => f.name)
    .join(", ");
  return `Valid filter fields for ${entity.type}: ${filterable || "none"}.\nSortable fields: ${sortable || "none"}.`;
}
