/**
 * Thrown by an operator tool to end the whole turn with `cause` instead of
 * handing the model a "Tool error" message.
 *
 * Opt-in: a tool that throws anything else keeps today's behaviour (the error
 * becomes a ToolMessage and the turn goes on). Use it when continuing would
 * only make the model paraphrase a failure the caller already handles, such
 * as an out-of-credits 402, so the request fails the same way it would have
 * failed at the start of the turn.
 */
export class OperatorTurnAbort extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "OperatorTurnAbort";
  }
}
