import { TokenUsageInterface } from "../token.usage.interface";

/**
 * A single date extracted from a chunk by the Graph Creator.
 */
export interface ChunkDateInterface {
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Brief description of the event / deadline the date refers to. */
  description: string;
}

/**
 * Interface for chunk analysis results from the Graph Creator
 */
export interface ChunkAnalysisInterface {
  atomicFacts: {
    content: string;
    keyConcepts: string[];
  }[];
  keyConceptsRelationships: {
    keyConcept1: string;
    keyConcept2: string;
    relationship: string;
  }[];
  keyConceptDescriptions: {
    keyConcept: string;
    description: string;
  }[];
  dates: ChunkDateInterface[];
  tokens: TokenUsageInterface;
}
