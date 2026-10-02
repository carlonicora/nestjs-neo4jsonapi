/**
 * Assistant title hook: app-provided generator for the display title of a new
 * assistant thread.
 *
 * The token is optional. When unbound, a new thread keeps the truncated first
 * question as its title, exactly as before. Bind it from a `@Global()`
 * application module so the AssistantModule, which imports no app modules,
 * can resolve it.
 */

/**
 * Contract implemented by an application-provided title generator.
 *
 * Called once per new thread, after the thread and its first user message are
 * persisted and before the agent turn runs. A caller-supplied title always
 * wins: the generator is not called when the request carries one.
 */
export interface AssistantTitleGenerator {
  /** Returns a short display title for a new thread, or undefined to fall back to the truncated question. Must not throw. */
  generate(params: { question: string; userMessageId: string; boundLabel?: string }): Promise<string | undefined>;
}

/**
 * Optional injection token resolving to an AssistantTitleGenerator.
 * When unbound, new threads keep the truncated-question title as before.
 */
export const ASSISTANT_TITLE_GENERATOR = Symbol("ASSISTANT_TITLE_GENERATOR");
