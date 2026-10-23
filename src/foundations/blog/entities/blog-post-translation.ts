import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { BlogTranslationSource } from "../blog.constants";
import type { BlogPost } from "./blog-post";
import { blogPostMeta } from "./blog-post.meta";
import { blogPostTranslationMeta } from "./blog-post-translation.meta";

/**
 * BlogPostTranslation Entity Type
 *
 * The text of one blog post in one language. Every post has exactly one
 * original translation (`isOriginal`) and one AI-maintained record per other
 * supported language.
 */
export type BlogPostTranslation = Entity & {
  language: string;
  isOriginal: boolean;
  source: BlogTranslationSource;
  aiStatus: string;
  title?: string;
  slug?: string;
  summary?: string;
  body?: string;
  bodyText?: string;
  coverImageAlt?: string;
  readingMinutes?: number;
  translatedAt?: Date;

  post?: BlogPost;
};

/**
 * BlogPostTranslation Entity Descriptor
 *
 * Single source of truth for the BlogPostTranslation entity configuration.
 * Only `title`, `summary` and `bodyText` are searchable, so the derived
 * FULLTEXT index `blogPostTranslation_search_index` covers exactly those three.
 */
export const BlogPostTranslationDescriptor = defineEntity<BlogPostTranslation>()({
  ...blogPostTranslationMeta,

  isCompanyScoped: false,
  // "internal": drafts and unpublished text must never reach the assistant catalog;
  // visitors read published posts through the public routes only.
  tenancy: "internal",

  description:
    "The text of one blog post in one language: title, slug, summary and body. Each post has one original translation, written by an administrator, and one record per other supported language, AI-translated from the original and optionally edited by hand.",

  fields: {
    language: {
      type: "string",
      required: true,
      excludeFromSearch: true,
      description:
        "The language code of this text (one of the app's supported languages). One record per language per post.",
    },
    isOriginal: {
      type: "boolean",
      required: true,
      description:
        "True for the text the administrator wrote, in the post's original language. Exactly one per post; every other language is translated from it.",
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
    title: {
      type: "string",
      description:
        "The post title in this language. Empty on a placeholder that is still waiting for its first translation.",
    },
    slug: {
      type: "string",
      excludeFromSearch: true,
      description:
        "The URL slug of the post in this language, built from the title in plain code (kebab-case ASCII). Unique per language across all posts; a collision gets -2, -3 and so on. Stable once the post is published.",
    },
    summary: {
      type: "string",
      description:
        "A short (about 160 characters) summary of the post in this language, shown as the teaser on the public list. AI-generated from the original body unless written by hand.",
    },
    body: {
      type: "string",
      excludeFromSearch: true,
      description: "The post body in this language, stored as BlockNote rich-text-editor JSON (not plain text).",
    },
    bodyText: {
      type: "string",
      description:
        "Plain text derived from the body. Feeds full-text search and the reading time; never edited directly.",
    },
    coverImageAlt: {
      type: "string",
      excludeFromSearch: true,
      description: "The description of the post's cover image in this language, used as the image alt text.",
    },
    readingMinutes: {
      type: "number",
      description:
        "Estimated reading time of this language's body in minutes (about 200 words per minute, at least 1).",
    },
    translatedAt: {
      type: "datetime",
      description:
        "When this language was last AI-translated from the original. Unset on the original and on placeholders not yet translated.",
    },
  },

  relationships: {
    post: {
      model: blogPostMeta,
      direction: "in",
      relationship: "HAS_TRANSLATION",
      cardinality: "one",
      description: "The blog post this text belongs to.",
    },
  },
});

export type BlogPostTranslationDescriptorType = typeof BlogPostTranslationDescriptor;
