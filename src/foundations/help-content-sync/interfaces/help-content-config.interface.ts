import { HelpArticle, HelpRedirect } from "./help-article.interface";

export interface HelpContentConfig {
  manifest: readonly HelpArticle[];
  readRawMarkdown: (article: HelpArticle) => Promise<string>;
  namespaceUuid: string;
  redirects?: readonly HelpRedirect[];
}
