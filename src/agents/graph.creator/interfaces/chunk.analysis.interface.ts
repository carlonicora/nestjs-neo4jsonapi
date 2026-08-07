import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { ChunkDateInterface } from "../../../common/interfaces/agents/graph.creator.interface";

// Single definition site for the date element — re-exported here so the public
// `agents` barrel can surface it alongside `ChunkAnalysisInterface`.
export type { ChunkDateInterface };

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
