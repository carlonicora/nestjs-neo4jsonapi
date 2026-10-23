import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { S3Service } from "../../s3/services/s3.service";
import type { User } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";
import { BlogPostStatus } from "../blog.constants";
import type { BlogCategory } from "./blog-category";
import { blogCategoryMeta } from "./blog-category.meta";
import type { BlogPostTranslation } from "./blog-post-translation";
import { blogPostTranslationMeta } from "./blog-post-translation.meta";
import { blogPostMeta } from "./blog-post.meta";

/**
 * BlogPost Entity Type
 *
 * The language-independent part of a blog post. The text lives on one
 * BlogPostTranslation per language; queries that resolve one language fill the
 * computed fields below.
 */
export type BlogPost = Entity & {
  status: BlogPostStatus;
  originalLanguage: string;
  coverImage?: string;
  publishedAt?: Date;

  // computed, filled only by public/admin-list queries that resolve one language
  language?: string;
  title?: string;
  slug?: string;
  summary?: string;
  body?: string;
  coverImageAlt?: string;
  readingMinutes?: number;
  authorName?: string;
  categoryIds?: string[];

  author?: User;
  categories?: BlogCategory[];
  translations?: BlogPostTranslation[];
};

const readString = (record: any, alias: string): string | undefined => {
  if (!record?.has?.(alias)) return undefined;
  const value = record.get(alias);
  return value === null || value === undefined ? undefined : String(value);
};

const readNumber = (record: any, alias: string): number | undefined => {
  if (!record?.has?.(alias)) return undefined;
  const value = record.get(alias);
  if (value === null || value === undefined) return undefined;
  if (value?.toNumber) return value.toNumber();
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * BlogPost Entity Descriptor
 *
 * Single source of truth for the BlogPost entity configuration.
 */
export const BlogPostDescriptor = defineEntity<BlogPost>()({
  ...blogPostMeta,

  isCompanyScoped: false,
  // "internal": drafts and unpublished text must never reach the assistant catalog;
  // visitors read published posts through the public routes only.
  tenancy: "internal",

  description:
    "A blog post of the platform's public blog: written by a platform administrator in one language and AI-translated into every supported language. Global content, not owned by any company. Its per-language text (title, summary, body) lives on its BlogPostTranslation records.",

  injectServices: [S3Service],

  fields: {
    status: {
      type: "string",
      required: true,
      excludeFromSearch: true,
      description:
        "Publication state: draft (never shown publicly), published (shown on the public blog) or unpublished (taken down; can be published again). Server-owned, changed only by the publish and unpublish actions.",
    },
    originalLanguage: {
      type: "string",
      required: true,
      excludeFromSearch: true,
      description:
        "The language code the post was written in (one of the app's supported languages). Set at creation and fixed afterwards; the translation in this language is the original every other language is translated from.",
    },
    coverImage: {
      type: "string",
      excludeFromSearch: true,
      description:
        "S3 key of the optional cover image, serialised as a signed public URL. Shown at the top of the post page and on the post's card in the public list.",
      transform: async (data, services) => {
        if (!data.coverImage) return undefined;
        if (data.coverImage.startsWith("~")) return data.coverImage.substring(1);
        return await services.S3Service.generateSignedUrl({ key: data.coverImage, isPublic: true });
      },
    },
    publishedAt: {
      type: "datetime",
      description:
        "When the post was first published. Set on the first publish and kept through unpublish and republish; the public list is ordered by it, newest first.",
    },
  },

  computed: {
    language: {
      description:
        "The language whose text the resolved fields carry: the requested language when its translation is completed, otherwise the original language. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedLanguage"),
    },
    title: {
      description: "The post title in the resolved language. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedTitle"),
    },
    slug: {
      description:
        "The URL slug of the post in the resolved language (kebab-case, unique per language). Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedSlug"),
    },
    summary: {
      description:
        "The short summary of the post in the resolved language. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedSummary"),
    },
    body: {
      description:
        "The post body in the resolved language, as BlockNote rich-text-editor JSON. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedBody"),
    },
    coverImageAlt: {
      description:
        "The cover image description in the resolved language. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readString(params.record, "resolvedCoverImageAlt"),
    },
    readingMinutes: {
      description:
        "Estimated reading time in minutes of the resolved-language body. Undefined outside language-resolving queries.",
      meta: true,
      compute: (params) => readNumber(params.record, "resolvedReadingMinutes"),
    },
    authorName: {
      description:
        "The display name of the administrator who wrote the post. Public reads return this instead of the author user, so no user data leaks.",
      meta: true,
      compute: (params) => readString(params.record, "authorName"),
    },
    categoryIds: {
      description: "Ids of the blog categories the post belongs to, as collected by public reads.",
      meta: true,
      compute: (params) => {
        if (!params.record?.has?.("categoryIds")) return undefined;
        const ids = params.record.get("categoryIds") ?? [];
        return (ids as unknown[]).filter((id) => id !== null && id !== undefined).map((id) => String(id));
      },
    },
  },

  relationships: {
    author: {
      model: userMeta,
      direction: "in",
      relationship: "AUTHORED",
      cardinality: "one",
      description: "The platform administrator who created the post. Set at creation, never editable.",
    },
    categories: {
      model: blogCategoryMeta,
      direction: "out",
      relationship: "IN_BLOG_CATEGORY",
      cardinality: "many",
      required: false,
      dtoKey: "categories",
      description: "The blog categories the post is filed under; the public list can be filtered by one of them.",
    },
    translations: {
      model: blogPostTranslationMeta,
      direction: "out",
      relationship: "HAS_TRANSLATION",
      cardinality: "many",
      required: false,
      description: "The per-language text records of the post, one per language, the original included.",
    },
  },
});

export type BlogPostDescriptorType = typeof BlogPostDescriptor;
