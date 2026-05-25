export const HELP_MODES = ["tutorial", "how-to", "reference", "explanation"] as const;
export type HelpMode = (typeof HELP_MODES)[number];

export interface HelpHeading {
  depth: 2 | 3;
  slug: string;
  text: string;
}

export interface HelpArticle {
  id: string;
  slug: string;
  mode: HelpMode;
  title: string;
  summary: string;
  order: number;
  tags: readonly string[];
  contextualKeys: readonly string[];
  aiIndexed: boolean;
  draft: boolean;
  contentHash: string;
  path: string;
  headings: readonly HelpHeading[];
  relatedSlugs: readonly string[];
  lastUpdated: string;
}

export interface HelpRedirect {
  from: string;
  to: string;
}
