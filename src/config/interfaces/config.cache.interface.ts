export interface ConfigCacheInterface {
  enabled: boolean;
  defaultTtl: number;
  skipPatterns: string[];
  /**
   * Namespace mixed into every LLM response-cache key, from CACHE_VERSION
   * (default "v1"). Bumping it invalidates every cached LLM response at once —
   * used when a prompt template or model mapping changes in a way that should
   * not serve stale hits. Unrelated to the HTTP cache above.
   */
  version: string;
}
