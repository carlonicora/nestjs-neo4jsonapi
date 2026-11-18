/** One active skill as the Assistant sees it in its list. */
export interface AssistantSkillSummary {
  name: string;
  description: string;
}

/** One skill with the instructions the Assistant follows. */
export interface AssistantLoadedSkill {
  name: string;
  instructions: string;
}

/**
 * Host hook: the active skills of the company the request runs as.
 * Bound by the opt-in Skill module from a `@Global()` module. Unbound, the
 * Assistant has no skills and behaves exactly as before.
 */
export interface AssistantSkillProvider {
  /** Active skills of the company in context (global ones only when there is no company). */
  listActive(): Promise<AssistantSkillSummary[]>;
  /** Instructions of the named skills; names that are not active for the caller are left out. */
  load(params: { names: string[] }): Promise<AssistantLoadedSkill[]>;
}

/** Optional DI token resolving to one AssistantSkillProvider. */
export const ASSISTANT_SKILL_PROVIDER = Symbol("ASSISTANT_SKILL_PROVIDER");
