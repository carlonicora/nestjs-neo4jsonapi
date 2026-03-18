import { defineEntity, Entity } from "@carlonicora/nestjs-neo4jsonapi";
import { User } from "@carlonicora/nestjs-neo4jsonapi";
import { userMeta } from "@carlonicora/nestjs-neo4jsonapi";
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

  relationships: {
    author: {
      model: userMeta,
      direction: "in",
      relationship: "PUBLISHED",
      cardinality: "one",
      dtoKey: "author",
      immutable: true,
    },
  },
});

export type HowToDescriptorType = typeof HowToDescriptor;
