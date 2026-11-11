/**
 * Thrown by `LLMService` when the provider's content filter refused a call.
 *
 * `stage` says which side was refused: `"prompt"` when the request was rejected before any
 * answer was generated, `"output"` when an answer was started and the filter stopped or
 * replaced it. `cause` is what the service classified: the provider error for a thrown
 * refusal, the raw response message for a refusal found on a response.
 *
 * The refusal is final. The same input gets the same refusal, so a caller records the
 * outcome and does not call the model again.
 */
export class LLMContentFilterError extends Error {
  readonly stage: "prompt" | "output";
  readonly cause: unknown;

  constructor(params: { stage: "prompt" | "output"; cause: unknown }) {
    super(`Content filter refused the ${params.stage}`);
    this.name = "LLMContentFilterError";
    this.stage = params.stage;
    this.cause = params.cause;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Says whether a thrown provider error or a raw response message is a content filter
 * refusal, and of which stage. Returns null for anything else.
 *
 * Five shapes are recognised:
 * 1. a thrown error with status 400 and `code === "content_filter"`, or
 *    `error.innererror.code === "ResponsibleAIPolicyViolation"`, or a message containing
 *    "content management policy": `"prompt"`;
 * 2. a thrown error whose `name` or `code` is `content_filter` and that has no status:
 *    `"output"`;
 * 3. a raw message with `response_metadata.status === "incomplete"` and
 *    `response_metadata.incomplete_details.reason === "content_filter"`: `"output"`;
 * 4. a raw message with `additional_kwargs.refusal` set: `"output"`. The caller applies
 *    this shape only when the response carried no parsed value;
 * 5. a raw message with `response_metadata.finish_reason === "content_filter"`, the chat
 *    completions shape: `"output"`.
 *
 * The status is read from `status`, then from `statusCode`.
 */
export function contentFilterOutcome(value: unknown): "prompt" | "output" | null {
  if (!isRecord(value)) return null;

  const status = value.status ?? value.statusCode;
  if (status === 400) {
    if (value.code === "content_filter") return "prompt";
    const body = value.error;
    if (isRecord(body) && isRecord(body.innererror) && body.innererror.code === "ResponsibleAIPolicyViolation")
      return "prompt";
    if (typeof value.message === "string" && value.message.includes("content management policy")) return "prompt";
  }
  if (status === undefined && (value.name === "content_filter" || value.code === "content_filter")) return "output";

  const metadata = value.response_metadata;
  if (isRecord(metadata)) {
    const details = metadata.incomplete_details;
    if (metadata.status === "incomplete" && isRecord(details) && details.reason === "content_filter") return "output";
    if (metadata.finish_reason === "content_filter") return "output";
  }

  const kwargs = value.additional_kwargs;
  if (isRecord(kwargs) && typeof kwargs.refusal === "string" && kwargs.refusal.length > 0) return "output";

  return null;
}
