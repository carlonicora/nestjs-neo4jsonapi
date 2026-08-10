export interface ConfigPromptsInterface {
  graphCreator?: string;
  contextualiser?: {
    questionRefiner?: string;
    rationalPlan?: string;
    keyConceptExtractor?: string;
    atomicFactsExtractor?: string;
    chunk?: string;
    chunkVector?: string;
  };
  responder?: string;
  /**
   * Overrides for the responder answer node's structured-output field
   * descriptions. Defaults are the library's historical strings — override
   * them when the app also overrides `responder`, so the schema docs do not
   * fight the system prompt.
   */
  responderSchemaDescriptions?: {
    analyse?: string;
    finalAnswer?: string;
  };
  /** Temperature for the responder answer node's LLM call. Default 0.1. */
  responderTemperature?: number;
  planner?: string;
  operator?: string;
  summariser?: {
    map?: string;
    combine?: string;
    tldr?: string;
  };
  // DRIFT-related prompts
  communitySummariser?: string;
  hydeGenerator?: string;
  driftPrimer?: string;
  driftFollowup?: string;
  driftSearch?: string;
}
