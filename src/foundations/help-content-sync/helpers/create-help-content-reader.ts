import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HelpArticle } from "../interfaces/help-article.interface";

export function createHelpContentReader(opts: { srcRoot: string }): (article: HelpArticle) => Promise<string> {
  return async (article: HelpArticle) => readFile(join(opts.srcRoot, article.path), "utf8");
}
