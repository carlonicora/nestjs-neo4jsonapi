import { defineEntity, Entity } from "../../../common";
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

  howToType?: string;
  slug?: string;
  order?: number;
  summary?: string;
  tags?: string[];
  contextualKeys?: string[];
  draft?: boolean;

  relevance?: number;
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

  description:
    "An in-app how-to/help guide (guida): a piece of onboarding/help documentation shown to users of the platform. Global content, visible to every company, optionally scoped to specific app pages via `pages`.",

  chat: {
    summary: (d) => d.name ?? d.id,
    textSearchFields: ["name", "description"],
  },

  fields: {
    name: {
      type: "string",
      required: true,
      description: 'The title of the how-to guide (e.g. "How to create a proceeding").',
    },
    description: {
      type: "string",
      required: true,
      description:
        "The guide's body content, stored as BlockNote rich-text-editor JSON (not plain text). Converted to Markdown before AI chunking/indexing.",
    },
    pages: {
      type: "string",
      description:
        'JSON-encoded array of in-app path fragments (e.g. ["/proceedings", "/documents"]) this guide is relevant for; used to surface contextual help suggestions based on the page the user is currently on.',
    },
    abstract: {
      type: "string",
      description:
        "A short AI-generated abstract of the guide's content, produced by the summarisation pass; empty until the guide has been processed.",
    },
    tldr: {
      type: "string",
      description:
        "The AI-generated too-long-didn't-read one-liner for the guide, used wherever the full abstract is too long to show.",
    },
    aiStatus: {
      type: "string",
      description:
        "AI chunking/indexing status of the guide content (pending, in_progress, completed, failed, ...), driving the background processing pipeline that makes the guide searchable/chat-queryable.",
    },
    howToType: {
      type: "string",
      description:
        "The documentation category of the article — one of tutorial, how-to, reference or explanation (the DTO rejects anything else). Combined with `slug` it addresses the article on the public knowledge-base routes, and it filters the published list.",
    },
    slug: {
      type: "string",
      description:
        "The URL-safe identifier of the article within its `howToType`; the (howToType, slug) pair uniquely addresses a published article on the public knowledge-base routes.",
    },
    order: {
      type: "number",
      description:
        "Manual sort position in the published knowledge base: published and related listings are ordered by `order` ascending, then by `name`.",
    },
    summary: {
      type: "string",
      description:
        "A short editor-written summary of the article, shown as its teaser in knowledge-base listings and previews.",
    },
    tags: {
      type: "string[]",
      description: "Free-form editorial tags used to label and group articles in the knowledge base.",
    },
    contextualKeys: {
      type: "string[]",
      description:
        'Application context keys (e.g. "npc.editor") naming the in-app surfaces this article explains; used to offer the article contextually from where the user is working.',
    },
    draft: {
      type: "boolean",
      description:
        "The publication gate: while true the article is unpublished and excluded from every public read — the published list, the by-type-and-slug lookup and the related list all require `draft` to be false or unset.",
    },
  },

  computed: {
    relevance: {
      description:
        "Search relevance score of this guide for the current query, taken from the `score` column of a search query; undefined outside search results.",
      compute: (params) => {
        if (!params.record.has("score")) return undefined;
        const score = params.record.get("score");
        if (score?.toNumber) return score.toNumber();
        return Number(score) || undefined;
      },
    },
  },

  relationships: {},
});

export type HowToDescriptorType = typeof HowToDescriptor;
