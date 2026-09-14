import { defineEntity, Entity } from "../../../common";
import { handbookPageMeta } from "./handbook-page.meta";

/**
 * One markdown file of an application's own developer documentation.
 *
 * Global content: like HowTo, a HandbookPage has NO `BELONGS_TO Company` edge.
 * Unlike HowTo it is developer-facing — every route is administrator-only and
 * retrieval reaches it only in handbook mode.
 */
export type HandbookPage = Entity & {
  path: string;
  title: string;
  content: string;
  contentHash: string;
  wordCount?: number;
  aiStatus?: string;
  section?: string;
  order?: string;
  summary?: string;
  displayTitle?: string;
  displaySummary?: string;
  displayContent?: string;
};

export const HandbookPageDescriptor = defineEntity<HandbookPage>()({
  ...handbookPageMeta,

  isCompanyScoped: false,

  fields: {
    path: { type: "string", required: true },
    title: { type: "string", required: true },
    content: { type: "string", required: true },
    contentHash: { type: "string", required: true },
    wordCount: { type: "number" },
    aiStatus: { type: "string" },

    /** The front matter `section`, falling back to the file's first path segment. */
    section: { type: "string" },

    /**
     * The repo-relative path of the file, lowercased.
     *
     * Sorting on it inside a section reproduces the order of the tree on disk,
     * because the directories — and the rulebook files inside them — carry
     * numeric prefixes (`00-start-here`, `03-backend`, …). A string, not a
     * number: nothing here does arithmetic, and a renamed file needs no
     * renumbering of its neighbours.
     */
    order: { type: "string" },

    /** The one-line description the tree's README index gives this path, when it has one. */
    summary: { type: "string" },

    /**
     * The display translation of this page, when the tree ships one.
     *
     * Written by the ingest's display pass from `<path>/<displayPath>/<same
     * relative path>`, and READ ONLY by the reading surface. Nothing here is
     * chunked, embedded or retrievable: `content` stays the indexed English
     * body, and `contentHash` is computed over the English file alone, so a
     * translation that changes re-embeds nothing.
     */
    displayTitle: { type: "string" },
    displaySummary: { type: "string" },
    displayContent: { type: "string" },
  },

  relationships: {},
});

export type HandbookPageDescriptorType = typeof HandbookPageDescriptor;
