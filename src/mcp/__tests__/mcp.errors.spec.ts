import { describe, it, expect } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { mcpError } from "../services/mcp.errors";

const parse = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);

describe("mcpError", () => {
  it("maps TimeoutError to timeout retryable", () => {
    const result = mcpError(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    expect(result.isError).toBe(true);
    expect(parse(result)).toEqual({
      code: "timeout",
      message: "The operation was aborted due to timeout",
      retryable: true,
    });
  });

  it("maps an Error named TimeoutError to timeout retryable", () => {
    const error = new Error("Request timed out");
    error.name = "TimeoutError";

    expect(parse(mcpError(error))).toEqual({ code: "timeout", message: "Request timed out", retryable: true });
  });

  it("keeps a plain Error internal", () => {
    expect(parse(mcpError(new Error("boom")))).toEqual({ code: "internal", message: "boom" });
  });

  it("keeps the HttpException status mapping", () => {
    expect(parse(mcpError(new NotFoundException("missing")))).toEqual({ code: "not_found", message: "missing" });
  });
});
