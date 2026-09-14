import { defineEntity, Entity } from "../../../common";
import { handbookSectionMeta } from "./handbook-section.meta";

/**
 * One top-level directory of the configured documentation tree.
 *
 * Global content: like HandbookPage, a HandbookSection has NO `BELONGS_TO
 * Company` edge — the tree belongs to the application, not to a tenant.
 *
 * A page names its section by the `section` key, not by an edge, so there is
 * nothing to join and nothing to write per page. The ingest replaces EVERY
 * section on each sync: there are ten of them and diffing buys nothing.
 */
export type HandbookSection = Entity & {
  key: string;
  title: string;
  summary?: string;
  order: string;
  displayTitle?: string;
  displaySummary?: string;
};

export const HandbookSectionDescriptor = defineEntity<HandbookSection>()({
  ...handbookSectionMeta,

  isCompanyScoped: false,

  fields: {
    key: { type: "string", required: true },
    title: { type: "string", required: true },
    summary: { type: "string" },
    order: { type: "string", required: true },

    /**
     * The display translation of the heading and its blurb, taken from the
     * display tree's own README. Absent when no `displayPath` is configured,
     * or when that README describes no such section.
     */
    displayTitle: { type: "string" },
    displaySummary: { type: "string" },
  },

  relationships: {},
});

export type HandbookSectionDescriptorType = typeof HandbookSectionDescriptor;
