import { HttpException } from "@nestjs/common";
import { ZodError } from "zod";
import type { McpToolResult } from "../interfaces/mcp.tool.interface";

/**
 * MCP tool error codes (C10). Every executor failure is returned to the MCP
 * client as a FLAT JSON payload `{ code, message, ...meta }` — mirroring the
 * flat-error convention used by the HTTP layer's HttpExceptionFilter.
 */
export type McpErrorCode =
  "unknown_type" | "not_writable" | "forbidden" | "validation_failed" | "not_found" | "internal" | "timeout";

/**
 * Maps an unknown thrown value to a flat MCP error result.
 *
 * - `HttpException` → status-derived code (404 → not_found, 403 → forbidden,
 *   400/422 → validation_failed, anything else → internal)
 * - `ZodError` → validation_failed with per-issue `issues` meta
 * - an error named `TimeoutError` (the `DOMException` an `AbortSignal.timeout`
 *   fetch rejects with) → timeout with `retryable: true`
 * - other `Error` → internal with the error message
 *
 * Never includes stack traces.
 */
export function mcpError(e: unknown): McpToolResult {
  let code: McpErrorCode = "internal";
  let message = "Unexpected error";
  let meta: Record<string, unknown> = {};
  if (e instanceof HttpException) {
    const status = e.getStatus();
    code =
      status === 404
        ? "not_found"
        : status === 403
          ? "forbidden"
          : status === 400 || status === 422
            ? "validation_failed"
            : "internal";
    message = e.message;
  } else if (e instanceof ZodError) {
    code = "validation_failed";
    message = "Input validation failed";
    meta = { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  } else if (isTimeoutError(e)) {
    code = "timeout";
    message = e.message;
    meta = { retryable: true };
  } else if (e instanceof Error) {
    message = e.message;
  }
  return mcpFlatError(code, message, meta);
}

function isTimeoutError(e: unknown): e is { name: string; message: string } {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "TimeoutError";
}

/**
 * Builds a flat MCP error result directly from a code + message (+ optional meta).
 * The payload shape is intentionally flat: `{ code, message, ...meta }`.
 */
export function mcpFlatError(code: string, message: string, meta: Record<string, unknown> = {}): McpToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message, ...meta }) }] };
}

/**
 * The ToolFactory's unknown-type error (`ToolFactory.resolveEntity`) always
 * starts `Entity type "<type>" is not available.`
 */
const UNKNOWN_TYPE_ERROR = /^Entity type "[^"]*" is not available\./;
/** `read_entity`'s missing-record error: `No <type> with id <id>.` */
const NOT_FOUND_ERROR = /^No \S+ with id \S+\.$/;
/** A catalog type whose service is not registered: a server defect, not a client error. */
const SERVICE_UNAVAILABLE_ERROR = /^Service not available for "[^"]*"\./;

function toolErrorCode(error: string): McpErrorCode {
  if (UNKNOWN_TYPE_ERROR.test(error)) return "unknown_type";
  if (NOT_FOUND_ERROR.test(error)) return "not_found";
  if (SERVICE_UNAVAILABLE_ERROR.test(error)) return "internal";
  return "validation_failed";
}

/**
 * Turns a graph tool's return value into an MCP result. The graph tools report
 * a client error as a value, `{ error, ...extras }`, so the LangGraph operator
 * can hand the message to the model; over MCP that value is a failed call and
 * must reach the client with `isError: true`, never as a success payload.
 * The ToolFactory's unknown-type error maps to `unknown_type`, a missing record
 * to `not_found`, an unregistered service to `internal`, every other tool-level
 * error to `validation_failed`; the extras (e.g. `schema`, `suggestion`) stay
 * on the payload.
 */
export function mcpToolResult(result: unknown): McpToolResult {
  if (typeof result === "object" && result !== null && typeof (result as { error?: unknown }).error === "string") {
    const { error, ...extras } = result as { error: string } & Record<string, unknown>;
    return mcpFlatError(toolErrorCode(error), error, extras);
  }
  return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] };
}
