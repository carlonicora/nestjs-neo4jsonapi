import { TokenUsageInterface } from "../token.usage.interface";

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
  dates: {
    date: string;
    description: string;
  }[];
  tokens: TokenUsageInterface;
}
