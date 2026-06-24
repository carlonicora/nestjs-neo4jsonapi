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
