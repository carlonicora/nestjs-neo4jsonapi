import { Injectable } from "@nestjs/common";

/**
 * Decides whether a ground-truth snippet is present in retrieved text.
 *
 * Deliberately forgiving on whitespace and case, and deliberately NOT fuzzy on
 * wording: a snippet is chosen by the question's author to be distinctive, so a
 * near-miss is a miss. Chunk ids and positions cannot anchor this — ids are
 * regenerated on every ingest and positions shift whenever the chunker changes.
 */
@Injectable()
export class EvidenceMatcher {
  private normalise(value: string): string {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }

  matches(params: { snippet: string; haystack: string }): boolean {
    const needle = this.normalise(params.snippet);
    if (needle === "") return false;
    return this.normalise(params.haystack).includes(needle);
  }

  score(params: { snippets: string[]; haystack: string }): { found: number; missing: string[] } {
    const missing = params.snippets.filter((snippet) => !this.matches({ snippet, haystack: params.haystack }));
    return { found: params.snippets.length - missing.length, missing };
  }
}
