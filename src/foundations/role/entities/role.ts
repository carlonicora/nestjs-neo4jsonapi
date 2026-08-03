import { Entity, defineEntity } from "../../../common";
import type { Feature } from "../../feature/entities/feature";
import { featureMeta } from "../../feature/entities/feature.meta";
import { roleMeta } from "./role.meta";

/**
 * Role Entity Type
 */
export type Role = Entity & {
  name: string;
  description?: string;
  isSelectable?: boolean;
  requiredFeature?: Feature;
};

/**
 * Role Entity Descriptor
 *
 * Single source of truth for the Role entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 */
export const RoleDescriptor = defineEntity<Role>()({
  ...roleMeta,

  // Field definitions
  fields: {
    name: { type: "string", required: true },
    description: { type: "string" },
    isSelectable: { type: "boolean" },
    requiredFeature: { type: "string" },
  },

  // Relationship definitions
  relationships: {
    feature: {
      model: featureMeta,
      direction: "out",
      relationship: "RELATED_TO",
      cardinality: "one",
      dtoKey: "requiredFeature",
    },
  },
});

// Type export for the descriptor
export type RoleDescriptorType = typeof RoleDescriptor;
