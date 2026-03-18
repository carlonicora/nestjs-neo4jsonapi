import { defineEntity, Entity } from "../../../common";
import { User } from "../../user/entities/user";
import { authorMeta } from "../../user/entities/user.meta";
import { howToMeta } from "./how-to.meta";

/**
 * HowTo Entity Type
 */
export type HowTo = Entity & {
  name: string;
  description: string;
  pages?: string;
  abstract?: string;
  tldr?: string;
  aiStatus?: string;

  relevance?: number;

  author: User;
};

/**
 * HowTo Entity Descriptor
 *
 * Single source of truth for the HowTo entity configuration.
 * Auto-generates mapper, serialiser, constraints, and indexes.
 */
export const HowToDescriptor = defineEntity<HowTo>()({
  ...howToMeta,

  isCompanyScoped: false,

  fields: {
    name: { type: "string", required: true },
    description: { type: "string", required: true },
    pages: { type: "string" },
    abstract: { type: "string" },
    tldr: { type: "string" },
    aiStatus: { type: "string" },
  },

  computed: {
    relevance: {
      compute: (params) => {
        if (!params.record.has("score")) return undefined;
        const score = params.record.get("score");
        if (score?.toNumber) return score.toNumber();
        return Number(score) || undefined;
      },
    },
  },

  relationships: {
    author: {
      model: authorMeta,
      direction: "in",
      relationship: "PUBLISHED",
      cardinality: "one",
      dtoKey: "author",
      immutable: true,
    },
  },
});

export type HowToDescriptorType = typeof HowToDescriptor;
