// packages/nestjs-neo4jsonapi/src/agents/responder/interfaces/entity.reference.interface.ts
export interface EntityReference {
  type: string;
  id: string;
  /** 0–100. Optional: a reference without a score is persisted with `relevance: null`. */
  relevance?: number;
  reason: string;
}
