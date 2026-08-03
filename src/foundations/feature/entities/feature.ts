import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { Module } from "../../module/entities/module.entity";
import { moduleMeta } from "../../module/entities/module.meta";
import { featureMeta } from "./feature.meta";

/**
 * Feature Entity Type
 */
export type Feature = Entity & {
  name: string;
  isCore: boolean;

  module: Module[];
};

/**
 * Feature Entity Descriptor
 *
 * Single source of truth for the Feature entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 */
export const FeatureDescriptor = defineEntity<Feature>()({
  ...featureMeta,

  // Features are global RBAC building blocks seeded once for the whole platform —
  // there is no (Feature)-[:BELONGS_TO]->(Company) edge in the graph. Companies opt
  // into features via a separate (Company)-[:HAS_FEATURE]->(Feature) edge (see
  // FeatureRepository.findByCompany). Leaving this unset (defaults to true) would
  // make the inherited buildDefaultMatch()/create()/put() require a BELONGS_TO edge
  // that never exists, silently returning zero rows / failing writes.
  isCompanyScoped: false,

  // Catalog metadata: consumed by GraphDescriptorRegistry/GraphCatalogService when a
  // host app graph-registers this descriptor. Inert for apps that never register it,
  // and invisible to JSON:API — but the catalog contract REQUIRES a top-level
  // description plus at least one described field, so these are not optional copy.
  description:
    "A platform feature flag: a named capability of the product that can be enabled per company " +
    "and that groups the RBAC modules (screens/entities) a company's users may access when the feature is on.",

  chat: {
    summary: (d) => d.name ?? d.id,
    textSearchFields: ["name"],
  },

  // Field definitions
  fields: {
    name: {
      type: "string",
      required: true,
      description: "The feature's display name.",
    },
    isCore: {
      type: "boolean",
      required: true,
      default: false,
      description:
        "Whether this feature is a core platform capability that every company has, as opposed to an opt-in add-on.",
    },
  },

  // Relationship definitions
  relationships: {
    module: {
      model: moduleMeta,
      direction: "in",
      relationship: "IN_FEATURE",
      cardinality: "many",
      dtoKey: "modules",
      description: "The RBAC modules (screens/entities) grouped under this feature.",
      // `reverse.description` is a REQUIRED key on RelationshipDef["reverse"] —
      // ported verbatim from the app descriptor (it was already English).
      reverse: {
        name: "feature",
        description: "The feature this RBAC module belongs to.",
      },
    },
  },
});

// Type export for the descriptor
export type FeatureDescriptorType = typeof FeatureDescriptor;
