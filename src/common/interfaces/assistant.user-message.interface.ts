/**
 * Assistant user-message hook: app-provided listener told about every user
 * turn the assistant persists.
 *
 * The token is optional. When unbound, the assistant behaves exactly as
 * before. Bind it from a `@Global()` application module so the
 * AssistantModule, which imports no app modules, can resolve it.
 */

/**
 * Contract implemented by an application-provided user-message listener.
 *
 * Called once per user turn, after the user message is persisted and before
 * the agent turn runs, on both the responder and the operator paths. A
 * rejection is logged and the turn carries on.
 */
export interface AssistantUserMessageListener {
  /** Called once per persisted user turn. Must not throw. */
  onUserMessage(params: {
    userId: string;
    companyId: string;
    assistantId: string;
    boundContent?: { type: string; id: string };
  }): Promise<void>;
}

/**
 * Optional injection token resolving to an AssistantUserMessageListener.
 * When unbound, user turns notify no one, as before.
 */
export const ASSISTANT_USER_MESSAGE_LISTENER = Symbol("ASSISTANT_USER_MESSAGE_LISTENER");
