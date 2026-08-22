export interface GraphNodeDomainPrompts {
  /** What this system's data is about. Opens the prompt. */
  role?: string;
  /** How far to traverse before answering. Rendered after the tool list. */
  depth?: string;
  /** Worked example for same-name candidates of different types. */
  disambiguation?: string;
  /** Storage conventions the catalogue cannot express (units, encodings). */
  dataConventions?: string;
  /** How to render values in `answer` — formatting, output language. */
  outputRules?: string;
}

export interface ConfigPromptsInterface {
  graphCreator?: string;
  /**
   * Overrides for the Graph Creator's structured-output field descriptions.
   *
   * Mirrors `responderSchemaDescriptions`, and for the same reason: these
   * strings travel INLINE with the output contract, so a model weighs them at
   * least as heavily as a rule stated a thousand tokens earlier in the system
   * prompt. The library defaults carry the examples of the domain this agent
   * was first written for; an app that overrides `graphCreator` and leaves
   * these alone has a prompt arguing with its own schema.
   */
  graphCreatorSchemaDescriptions?: {
    keyConcepts?: string;
    atomicFact?: string;
    keyConceptDescription?: string;
  };
  contextualiser?: {
    questionRefiner?: string;
    rationalPlan?: string;
    keyConceptExtractor?: string;
    atomicFactsExtractor?: string;
    /**
     * @deprecated No longer read. The chunks node stopped making a per-chunk
     * LLM call — it writes the retrieved source text to the notebook verbatim —
     * so there is no prompt to override. Kept declared so apps that still set
     * it keep compiling; the value is ignored.
     */
    chunk?: string;
    /**
     * @deprecated No longer read. The chunk_vector node stopped making a
     * per-chunk LLM call — it writes the retrieved source text to the notebook
     * verbatim — so there is no prompt to override. Kept declared so apps that
     * still set it keep compiling; the value is ignored.
     */
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
  /**
   * Domain layer for the graph retrieval branch.
   *
   * The kernel prompt states no domain: it serves an ERP, a legal practice
   * system and a campaign planner, and a prompt that names one of them is
   * wrong for the other two. Every slot is optional and falls back to the
   * kernel; an app that supplies nothing gets a generic but complete prompt,
   * not a broken one.
   */
  graphNodeDomain?: GraphNodeDomainPrompts;
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
