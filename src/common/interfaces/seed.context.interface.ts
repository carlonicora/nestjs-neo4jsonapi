/**
 * Seed context: blocks of app-provided context guaranteed present in an
 * assistant turn, independent of what the retrieval branches fetch.
 *
 * Host applications implement AssistantSeedContextProvider and register an
 * array of providers under ASSISTANT_SEED_CONTEXT_PROVIDERS (from a global
 * module, so the AssistantModule — which imports no app modules — can resolve
 * it). The token is optional: when absent, assistant turns run exactly as
 * before.
 */

/**
 * An entity backing a seed context block.
 */
export interface AssistantSeedContextReference {
  /** Module/entity type of the referenced record. */
  type: string;
  /** Identifier of the referenced record. */
  id: string;
  /** Why this entity is part of the seed context. */
  reason: string;
  /** Optional extra attributes carried alongside the reference. */
  fields?: Record<string, unknown>;
}

/**
 * A single pre-rendered block of guaranteed context.
 */
export interface AssistantSeedContext {
  /** Section heading rendered into the prompt, e.g. "CAMPAIGN TIMELINE — KEY EVENTS". */
  title: string;
  /** Pre-rendered text block. The app owns the formatting. */
  content: string;
  /** Entities backing this context, merged into the responder ref-handle map so answers can cite them. */
  references?: AssistantSeedContextReference[];
}

/**
 * Parameters handed to every seed-context provider for the current turn.
 */
export interface AssistantSeedContextProviderParams {
  companyId: string;
  userId: string;
  userModuleIds: string[];
  scopeId?: string;
  scopeType?: string;
  contentId?: string;
  contentType?: string;
  question: string;
}

/**
 * Contract implemented by an application-provided seed-context provider.
 *
 * Return null when the provider has nothing to contribute to this turn.
 */
export interface AssistantSeedContextProvider {
  provide(params: AssistantSeedContextProviderParams): Promise<AssistantSeedContext | null>;
}

/**
 * Optional injection token resolving to an array of
 * AssistantSeedContextProvider implementations. Bind it in a `@Global()`
 * application module; when unbound, assistant turns run without seed contexts.
 */
export const ASSISTANT_SEED_CONTEXT_PROVIDERS = Symbol("ASSISTANT_SEED_CONTEXT_PROVIDERS");
