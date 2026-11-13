import { describe, expect, it } from "vitest";
import { isAssistantClientContext, parseAssistantClientContext } from "../assistant.client-context.interface";

const keys = (count: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index}`, "v"]));

describe("isAssistantClientContext", () => {
  it("accepts a plain object of string values", () => {
    expect(isAssistantClientContext({ a: "1", b: "x" })).toBe(true);
  });

  it("accepts eight keys", () => {
    expect(isAssistantClientContext(keys(8))).toBe(true);
  });

  it("rejects null", () => {
    expect(isAssistantClientContext(null)).toBe(false);
  });

  it("rejects an array", () => {
    expect(isAssistantClientContext(["a"])).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(isAssistantClientContext({ a: 1 })).toBe(false);
  });

  it("rejects nine keys", () => {
    expect(isAssistantClientContext(keys(9))).toBe(false);
  });

  it("rejects a 65-char key", () => {
    expect(isAssistantClientContext({ ["k".repeat(65)]: "v" })).toBe(false);
  });

  it("rejects an empty key", () => {
    expect(isAssistantClientContext({ "": "v" })).toBe(false);
  });

  it("rejects a 257-char value", () => {
    expect(isAssistantClientContext({ a: "v".repeat(257) })).toBe(false);
  });
});

describe("parseAssistantClientContext", () => {
  it("parses a stored JSON object", () => {
    expect(parseAssistantClientContext('{"a":"b"}')).toEqual({ a: "b" });
  });

  it("returns undefined when absent", () => {
    expect(parseAssistantClientContext(undefined)).toBeUndefined();
    expect(parseAssistantClientContext(null)).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseAssistantClientContext("not json")).toBeUndefined();
  });

  it("returns undefined when the parsed value fails the guard", () => {
    expect(parseAssistantClientContext('{"a":1}')).toBeUndefined();
  });
});
