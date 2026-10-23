import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { BlogTranslationSource } from "../blog.constants";
import type { BlogCategory } from "./blog-category";
import { blogCategoryMeta } from "./blog-category.meta";
import { blogCategoryTranslationMeta } from "./blog-category-translation.meta";

/**
 * BlogCategoryTranslation Entity Type
 *
 * The name, slug and description of one blog category in one language.
 */
export type BlogCategoryTranslation = Entity & {
  language: string;
  isOriginal: boolean;
  source: BlogTranslationSource;
  aiStatus: string;
  name?: string;
  slug?: string;
  description?: string;
  translatedAt?: Date;

  category?: BlogCategory;
};

/**
 * BlogCategoryTranslation Entity Descriptor
 *
 * Single source of truth for the BlogCategoryTranslation entity configuration.
 * Only `name` and `description` are searchable.
 */
export const BlogCategoryTranslationDescriptor = defineEntity<BlogCategoryTranslation>()({
  ...blogCategoryTranslationMeta,

  isCompanyScoped: false,
  tenancy: "global",

  description:
    "The text of one blog category in one language: name, slug and description. Each category has one original translation, written by an administrator, and one record per other supported language, AI-translated from the original and optionally edited by hand.",

  fields: {
    language: {
      type: "string",
      required: true,
      excludeFromSearch: true,
      description:
        "The language code of this text (one of the app's supported languages). One record per language per category.",
    },
    isOriginal: {
      type: "boolean",
      required: true,
      description:
        "True for the text the administrator wrote, in the category's original language. Exactly one per category; every other language is translated from it.",
    },
    source: {
      type: "string",
      required: true,
      excludeFromSearch: true,
      description:
        "Who produced the text: original (written by the administrator), ai (machine translation of the original) or manual (an AI translation an administrator edited by hand; re-translating the original overwrites it).",
    },
    aiStatus: {
      type: "string",
      required: true,
      excludeFromSearch: true,
      description:
        "Translation state of this language: pending (queued), in_progress, completed or failed. The original is always completed. Public reads use a translation only once it is completed, otherwise they fall back to the original.",
    },
    name: {
      type: "string",
      description:
        "The category name in this language. Empty on a placeholder that is still waiting for its first translation.",
    },
    slug: {
      type: "string",
      excludeFromSearch: true,
      description:
        "The URL slug of the category in this language, built from the name in plain code (kebab-case ASCII). Unique per language across all categories; used as the public list's category filter.",
    },
    description: {
      type: "string",
      description: "The category description in this language.",
    },
    translatedAt: {
      type: "datetime",
      description:
        "When this language was last AI-translated from the original. Unset on the original and on placeholders not yet translated.",
    },
  },

  relationships: {
    category: {
      model: blogCategoryMeta,
      direction: "in",
      relationship: "HAS_TRANSLATION",
      cardinality: "one",
      description: "The blog category this text belongs to.",
    },
  },
});

export type BlogCategoryTranslationDescriptorType = typeof BlogCategoryTranslationDescriptor;
