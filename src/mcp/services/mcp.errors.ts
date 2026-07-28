import { HttpException } from "@nestjs/common";
import { ZodError } from "zod";
import type { McpToolResult } from "../interfaces/mcp.tool.interface";

/**
 * MCP tool error codes (C10). Every executor failure is returned to the MCP
 * client as a FLAT JSON payload `{ code, message, ...meta }` — mirroring the
 * flat-error convention used by the HTTP layer's HttpExceptionFilter.
 */
export type McpErrorCode = "unknown_type" | "forbidden" | "validation_failed" | "not_found" | "internal";

/**
 * Maps an unknown thrown value to a flat MCP error result.
 *
 * - `HttpException` → status-derived code (404 → not_found, 403 → forbidden,
 *   400/422 → validation_failed, anything else → internal)
 * - `ZodError` → validation_failed with per-issue `issues` meta
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
  } else if (e instanceof Error) {
    message = e.message;
  }
  return mcpFlatError(code, message, meta);
}

/**
 * Builds a flat MCP error result directly from a code + message (+ optional meta).
 * The payload shape is intentionally flat: `{ code, message, ...meta }`.
 */
export function mcpFlatError(code: string, message: string, meta: Record<string, unknown> = {}): McpToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message, ...meta }) }] };
}
