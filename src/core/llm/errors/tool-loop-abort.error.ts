/**
 * Thrown by a tool to stop the run it is part of.
 *
 * Any other error a tool throws inside the `LLMService.call` tool loop is answered to the
 * model as a tool message, and the model decides what to do next. This one is not answered:
 * it leaves the loop, `call()` records the usage of the model rounds already made, and the
 * caller receives the same instance, not wrapped. `cause` is the failure that made the
 * tool give up, for example a dependency that did not answer.
 */
export class ToolLoopAbortError extends Error {
  readonly cause: unknown;

  constructor(params: { message: string; cause: unknown }) {
    super(params.message);
    this.name = "ToolLoopAbortError";
    this.cause = params.cause;
  }
}
