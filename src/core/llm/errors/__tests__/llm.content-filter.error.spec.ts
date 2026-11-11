import { describe, expect, it } from "vitest";
import { LLMContentFilterError, contentFilterOutcome } from "../llm.content-filter.error";

describe("contentFilterOutcome", () => {
  describe("shape 1: a thrown error with status 400 is a refused prompt", () => {
    it("classifies a 400 content_filter error as prompt", () => {
      expect(contentFilterOutcome(Object.assign(new Error("x"), { status: 400, code: "content_filter" }))).toBe(
        "prompt",
      );
    });

    it("classifies ResponsibleAIPolicyViolation as prompt", () => {
      expect(
        contentFilterOutcome({ status: 400, error: { innererror: { code: "ResponsibleAIPolicyViolation" } } }),
      ).toBe("prompt");
    });

    it("classifies a content management policy message as prompt", () => {
      expect(
        contentFilterOutcome(Object.assign(new Error("blocked by the content management policy"), { status: 400 })),
      ).toBe("prompt");
    });

    it("reads the status from statusCode when status is absent", () => {
      expect(contentFilterOutcome(Object.assign(new Error("x"), { statusCode: 400, code: "content_filter" }))).toBe(
        "prompt",
      );
    });

    it("returns null for a 400 that is not a content filter refusal", () => {
      expect(
        contentFilterOutcome(Object.assign(new Error("Invalid schema for response_format"), { status: 400 })),
      ).toBeNull();
      expect(
        contentFilterOutcome(Object.assign(new Error("x"), { status: 400, code: "invalid_request_error" })),
      ).toBeNull();
    });

    it("returns null for content_filter on a status other than 400", () => {
      expect(contentFilterOutcome(Object.assign(new Error("x"), { status: 500, code: "content_filter" }))).toBeNull();
    });
  });

  describe("shape 2: a thrown error with no status is a refused output", () => {
    it("classifies a status-less content_filter error as output", () => {
      expect(contentFilterOutcome(Object.assign(new Error("x"), { code: "content_filter" }))).toBe("output");
    });

    it("classifies a status-less error named content_filter as output", () => {
      expect(contentFilterOutcome(Object.assign(new Error("x"), { name: "content_filter" }))).toBe("output");
    });
  });

  describe("shape 3: an incomplete Responses API message", () => {
    it("classifies an incomplete response with reason content_filter as output", () => {
      expect(
        contentFilterOutcome({
          response_metadata: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
        }),
      ).toBe("output");
    });

    it("returns null for an incomplete response with another reason", () => {
      expect(
        contentFilterOutcome({
          response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
        }),
      ).toBeNull();
    });

    it("returns null for a completed response that carries a stale content_filter reason", () => {
      expect(
        contentFilterOutcome({
          response_metadata: { status: "completed", incomplete_details: { reason: "content_filter" } },
        }),
      ).toBeNull();
    });
  });

  describe("shape 4: a refusal part", () => {
    it("classifies a refusal with no parsed value as output", () => {
      expect(contentFilterOutcome({ additional_kwargs: { refusal: "I cannot" } })).toBe("output");
    });

    it("returns null when the refusal is empty or absent", () => {
      expect(contentFilterOutcome({ additional_kwargs: { refusal: "" } })).toBeNull();
      expect(contentFilterOutcome({ additional_kwargs: { refusal: null } })).toBeNull();
      expect(contentFilterOutcome({ additional_kwargs: {} })).toBeNull();
    });
  });

  describe("shape 5: the chat completions finish reason", () => {
    it("classifies finish_reason content_filter as output", () => {
      expect(contentFilterOutcome({ response_metadata: { finish_reason: "content_filter" } })).toBe("output");
    });
  });

  it("returns null for anything else", () => {
    expect(contentFilterOutcome(new Error("timeout"))).toBeNull();
    expect(contentFilterOutcome({ response_metadata: { finish_reason: "stop" } })).toBeNull();
  });

  it("returns null for a value that is not an object", () => {
    expect(contentFilterOutcome(null)).toBeNull();
    expect(contentFilterOutcome(undefined)).toBeNull();
    expect(contentFilterOutcome("content_filter")).toBeNull();
    expect(contentFilterOutcome(400)).toBeNull();
  });
});

describe("LLMContentFilterError", () => {
  it("carries the stage and the cause", () => {
    const cause = Object.assign(new Error("x"), { status: 400, code: "content_filter" });

    const error = new LLMContentFilterError({ stage: "prompt", cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LLMContentFilterError);
    expect(error.name).toBe("LLMContentFilterError");
    expect(error.stage).toBe("prompt");
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("Content filter refused the prompt");
  });

  it("names the output stage in its message", () => {
    const raw = { response_metadata: { finish_reason: "content_filter" } };

    const error = new LLMContentFilterError({ stage: "output", cause: raw });

    expect(error.stage).toBe("output");
    expect(error.cause).toBe(raw);
    expect(error.message).toBe("Content filter refused the output");
  });
});
