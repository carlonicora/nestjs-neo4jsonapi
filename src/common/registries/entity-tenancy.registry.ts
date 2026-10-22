import { EntityLinkScope, EntityTenancy, RelationshipDef } from "../interfaces/entity.schema.interface";

/** The one hop from a `tenancy: { via }` entity to the parent that carries its company. */
export type RelatedNodeHop = {
  /** Neo4j relationship type of the hop (e.g. "BELONGS_TO"). */
  relationship: string;
  /** "out" = (target)-[:REL]->(parent), "in" = (target)<-[:REL]-(parent). */
  direction: "in" | "out";
  /** Label of the parent. `Company` means the parent IS the company (matched by id). */
  label: string;
};

/**
 * What a related node of a relationship write must satisfy, beyond existing.
 *
 * - `exists`: existence only (global / internal / undescribed targets, `crossCompany`
 *   relationships, the caller's own user id, server-filled `contextKey` values).
 * - `company`: `(t)-[:BELONGS_TO]->(:Company {id: $companyId})`. A node with several
 *   BELONGS_TO edges (a User member of several companies) passes when ANY edge points at it.
 * - `self`: the target is the company itself (`t.id = $companyId`).
 * - `via`: the target's parent through `hop` belongs to the company (one hop).
 * - `allowPlatform` (company / via): a target with no company edge (no parent through the hop)
 *   is also accepted — the entity's `linkScope: "own-or-platform"`.
 */
export type RelatedNodeRule =
  | { kind: "exists" }
  | { kind: "self" }
  | { kind: "company"; allowPlatform?: boolean }
  | { kind: "via"; hop: RelatedNodeHop; allowPlatform?: boolean };

/** What the registry knows about the label of an entity defined with `defineEntity`. */
export type EntityTenancyEntry = {
  labelName: string;
  isCompanyScoped: boolean;
  tenancy?: EntityTenancy;
  linkScope?: EntityLinkScope;
  /** Resolved `tenancy.via` hop (only for `tenancy: { via }`). */
  via?: RelatedNodeHop;
};

/**
 * Label → tenancy registry, filled by `defineEntity()` at import time.
 *
 * The generic relationship writers read it to decide what a client-supplied target id must
 * satisfy (see `relatedNodeRule`). A label never passed to `defineEntity` (plain-model
 * entities such as StripePrice, OAuthClient, Module) is unknown and checked for existence only.
 * When two descriptors declare the same label, the one defined last wins (an app's extended
 * descriptor is imported after the library's).
 *
 * NOT @Injectable: populated before NestJS bootstraps, like `modelRegistry`.
 */
export class EntityTenancyRegistry {
  private readonly entries = new Map<string, EntityTenancyEntry>();

  register(entry: EntityTenancyEntry): void {
    this.entries.set(entry.labelName, entry);
  }

  get(labelName: string): EntityTenancyEntry | undefined {
    return this.entries.get(labelName);
  }

  /** Test helper: removes one label (or every label) from the registry. */
  unregister(labelName?: string): void {
    if (labelName === undefined) this.entries.clear();
    else this.entries.delete(labelName);
  }
}

export const entityTenancyRegistry = new EntityTenancyRegistry();

/**
 * The rule a target of `label` must satisfy for the caller's company, from the registry:
 * company-scoped → `company`; tenancy "self" → `self`; tenancy { via } → `via`; anything else
 * (global, internal, unscoped without tenancy, unknown label) → `exists`. `linkScope:
 * "own-or-platform"` adds `allowPlatform` to `company` / `via`.
 */
export const relatedNodeRuleForLabel = (label: string): RelatedNodeRule => {
  const entry = entityTenancyRegistry.get(label);
  if (!entry) return { kind: "exists" };
  const allowPlatform = entry.linkScope === "own-or-platform";

  if (entry.isCompanyScoped) return allowPlatform ? { kind: "company", allowPlatform } : { kind: "company" };
  if (entry.tenancy === "self") return { kind: "self" };
  if (entry.via)
    return allowPlatform ? { kind: "via", hop: entry.via, allowPlatform } : { kind: "via", hop: entry.via };
  return { kind: "exists" };
};

/**
 * The rule for the targets of one relationship of a descriptor: `crossCompany: true` and
 * server-filled `contextKey` relationships are existence-only, everything else follows the
 * target label (`relatedNodeRuleForLabel`).
 */
export const relatedNodeRule = (rel: RelationshipDef): RelatedNodeRule => {
  if (rel.crossCompany || rel.contextKey) return { kind: "exists" };
  return relatedNodeRuleForLabel(rel.model.labelName);
};
