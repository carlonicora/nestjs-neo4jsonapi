/**
 * Where an application keeps the documentation this foundation ingests.
 *
 * `path` unset is the library default: the feature loads, mounts its routes and
 * does nothing. `sync` refuses rather than guessing a directory, which is what
 * keeps a deployed image — which ships no docs/ tree — inert.
 */
export interface HandbookModuleConfig {
  /** Absolute, or relative to process.cwd(). */
  path?: string;
  /** Glob patterns, relative to `path`, excluded from the walk. e.g. ["it/**"] */
  exclude?: string[];
  /**
   * Subdirectory of `path` holding the display translation, e.g. "it". Unset =
   * English everywhere.
   *
   * The translation is SHOWN, never INDEXED: the tree it names must also be
   * `exclude`d, so the English walk skips it, and the display pass writes only
   * `displayTitle` / `displaySummary` / `displayContent` onto pages the English
   * walk already created. Nothing in it is chunked, embedded or retrievable.
   */
  displayPath?: string;
}

export const HANDBOOK_CONFIG = Symbol("HANDBOOK_CONFIG");

export const DEFAULT_HANDBOOK_CONFIG: Required<HandbookModuleConfig> = {
  path: "",
  exclude: [],
  displayPath: "",
};
