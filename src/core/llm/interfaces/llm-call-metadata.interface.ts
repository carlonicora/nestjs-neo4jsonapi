/**
 * Typed metadata passed to every LLMService.call(). The dumper reads from this
 * to attribute a JSON dump to a specific node and request. Also forwarded to
 * LangSmith via the underlying invoke() configOptions.
 *
 * `requestId`, `userId`, `companyId` are populated by `LLMCallDumper` itself
 * from `ClsService.get("logContext")` and do not need to be set by callers.
 */
export interface LLMCallMetadata {
  /** Logical node name. Examples: "graph", "planner", "answer". */
  nodeName: string;

  /** Logical agent name. Examples: "responder", "drift", "contextualiser". */
  agentName: string;

  /** The user's refined question for this turn. Optional but useful for attribution. */
  userQuestion?: string;

  /** Free-form fields are still allowed (LangSmith etc. may want them). */
  [extra: string]: unknown;
}
