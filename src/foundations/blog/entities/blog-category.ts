import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { S3Service } from "../../s3/services/s3.service";
import type { BlogCategoryTranslation } from "./blog-category-translation";
import { blogCategoryTranslationMeta } from "./blog-category-translation.meta";
import { blogCategoryMeta } from "./blog-category.meta";

/**
 * BlogCategory Entity Type
 *
 * The language-independent part of a blog category. Its name, slug and
 * description live on one BlogCategoryTranslation per language; queries that
 * resolve one language fill the computed fields below.
 */
export type BlogCategory = Entity & {
  originalLanguage: string;
  image?: string;

  // computed, filled only by queries that resolve one language
  language?: string;
  name?: string;
  slug?: string;
  description?: string;

  translations?: BlogCategoryTranslation[];
};

const readString = (record: any, alias: string): string | undefined => {
  if (!record?.has?.(alias)) return undefined;
  const value = record.get(alias);
  return value === null || value === undefined ? undefined : String(value);
};

/**
 * BlogCategory Entity Descriptor
 *
 * Single source of truth for the BlogCategory entity configuration.
 */
export const BlogCategoryDescriptor = defineEntity<BlogCategory>()({
  ...blogCategoryMeta,

  isCompanyScoped: false,
  tenancy: "global",

  description:
    "A category of the platform's public blog, used to group posts and filter the public list. Global content, not owned by any company. Its per-language name and description live on its BlogCategoryTranslation records.",

  injectServices: [S3Service],

  fields: {
    originalLanguage: {
      type: "string",
      required: true,
      excludeFromSearch: true,
      description:
        "The language code the category was written in. Set at creation and fixed afterwards; every other language is translated from this one.",
    },
    image: {
      type: "string",
      excludeFromSearch: true,
      description: "S3 key of the optional category image, serialised as a signed public URL.",
      transform: async (data, services) => {
        if (!data.image) return undefined;
        if (data.image.startsWith("~")) return data.image.substring(1);
        return await services.S3Service.generateSignedUrl({ key: data.image, isPublic: true });
      },
    },
  },

  computed: {
    language: {
      description:
        "The language whose text the resolved fields carry: the requested language when its translation is completed, otherwise the original language. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedLanguage"),
    },
    name: {
      description: "The category name in the resolved language. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedName"),
    },
    slug: {
      description:
        "The URL slug of the category in the resolved language, used as the public list's category filter. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedSlug"),
    },
    description: {
      description: "The category description in the resolved language. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedDescription"),
    },
  },

  relationships: {
    translations: {
      model: blogCategoryTranslationMeta,
      direction: "out",
      relationship: "HAS_TRANSLATION",
      cardinality: "many",
      required: false,
      description: "The per-language text records of the category, one per language, the original included.",
    },
  },
});

export type BlogCategoryDescriptorType = typeof BlogCategoryDescriptor;
