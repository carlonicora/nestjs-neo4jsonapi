/**
 * Two AI-status vocabularies coexist in this codebase — DO NOT unify them:
 *
 * - `AiStatus` (this enum) is the CHUNK-level vocabulary (lowercase snake_case
 *   values) used by content-chunking / transcription pipelines.
 * - `EntityAiStatus` (below) is the ENTITY-level vocabulary (PascalCase values)
 *   already persisted on narr8's 13 KG entities (Campaign, Clue, Consequence,
 *   Decision, Event, Faction, Goal, Item, Location, Npc, Pc, Secret, Threat).
 *
 * Stored values in both are PERMANENT — once written to Neo4j they may never be
 * renamed, only appended to. This mirrors the precedent set by
 * `Narr8TokenUsageType`.
 */
export enum AiStatus {
  Pending = "pending",
  InProgress = "in_progress",
  Completed = "completed",
  Failed = "failed",
  Summarising = "summarising",
  PendingCredits = "pending_credits",
  Discarded = "discarded",
}

/**
 * Entity-level AI status vocabulary (PascalCase values are what narr8's 13 KG
 * entities already store). VALUES ARE PERMANENT — see the vocabulary note above.
 */
export const EntityAiStatus = {
  Pending: "Pending",
  Summarising: "Summarising",
  Completed: "Completed",
  Failed: "Failed",
  PendingCredits: "PendingCredits",
  Discarded: "Discarded",
} as const;

export type EntityAiStatus = (typeof EntityAiStatus)[keyof typeof EntityAiStatus];
