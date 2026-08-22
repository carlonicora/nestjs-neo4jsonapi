/**
 * Builds the `$term` parameter handed to `db.index.fulltext.queryNodes`.
 *
 * Ported from `apps/corpus`'s `buildFulltextWildcardQuery`, which already
 * solved this correctly — see that file's rationale, reproduced here because
 * this is now the shared implementation.
 *
 * TWO separate problems, both fixed by tokenising:
 *
 * 1. CRASH. The term is passed as a Cypher parameter, so this was never a
 *    Cypher injection — but the value is then parsed by Lucene's classic query
 *    parser, which treats `+ - && || ! ( ) { } [ ] ^ " ~ * ? : \ /` as syntax.
 *    A raw term containing any of them raised a TokenMgrError inside the
 *    procedure and the request 500'd. A user searching a case number
 *    ("123/2026"), a hyphenated name or a time ("10:00") hit this on every
 *    `?search=` in the system.
 *
 * 2. NO MATCH. Escaping alone is NOT sufficient, which is the trap: the
 *    fulltext index ANALYSER splits on `/`, `.` and whitespace, so a single
 *    `*123\/2026*` parses fine and then matches nothing, because no indexed
 *    token contains the slash. The stored tokens for "E2E Causa Civile
 *    123/2026" are `e2e`, `causa`, `civile`, `123`, `2026`.
 *
 * Tokenising on non-alphanumerics and AND-joining a contains-wildcard per
 * token solves both: the special characters never reach the parser, and each
 * wildcard is matched against the tokens the analyser actually produced.
 *
 *   "1195"        -> *1195*
 *   "123/2026"    -> *123* AND *2026*
 *   "l. 1195"     -> *l* AND *1195*
 *
 * `\p{L}\p{N}` keeps accented Italian letters (à, è, …) intact rather than
 * splitting on them.
 *
 * NOTE ON SEMANTICS: a multi-word term is now AND-joined. Previously the whole
 * term was wrapped as `*foo bar*`, which Lucene parsed as `*foo` OR `bar*` —
 * so a two-word search matched rows containing EITHER word. AND is both
 * narrower and what users expect from a search box.
 */

/** Lucene's classic-parser reserved characters. */
const LUCENE_RESERVED_RE = /[+\-&|!(){}[\]^"~*?:\\/]/g;

/**
 * Escapes Lucene query syntax in a raw term, for the callers that need the
 * term itself rather than a tokenised wildcard query (e.g. fuzzy `term~`
 * searches, where tokenising would change the meaning).
 */
export function escapeLuceneTerm(term: string): string {
  return term.replace(LUCENE_RESERVED_RE, "\\$&");
}

/**
 * Produces the wildcard query for a user search term, or `undefined` when
 * there is no term at all.
 *
 * Returns `"*"` (match-all) — never `undefined` — for a non-empty term that
 * tokenises to nothing (e.g. "///"), because every call site guards on
 * `if (params.term)` and then references `$term` in the Cypher: handing back
 * `undefined` there would leave the parameter unbound and fail the query.
 */
export function buildFulltextTerm(term: string | undefined | null): string | undefined {
  // Only "no term supplied" yields undefined. An EMPTY string is a supplied
  // term and must still produce a bindable value: `search.repository.find`
  // takes a required `term: string` and references `$term` unconditionally, so
  // undefined there would leave the parameter unbound and fail the query.
  if (term === undefined || term === null) return undefined;
  const tokens = term
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (tokens.length === 0) return "*";
  return tokens.map((t) => `*${t}*`).join(" AND ");
}
