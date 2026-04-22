import { describe, it, expect } from "vitest";
import { humanizeTool } from "../humanize-tool";

describe("humanizeTool", () => {
  it("renders describe_entity", () => {
    expect(humanizeTool("describe_entity", { type: "orders" })).toBe("Looking up orders schema");
  });
  it("renders search_entities as a typed search (no text component)", () => {
    expect(humanizeTool("search_entities", { type: "persons" })).toBe("Searching persons");
  });
  it("renders resolve_entity with the user's literal text", () => {
    expect(humanizeTool("resolve_entity", { text: "Faby and Carlo" })).toBe(
      'Resolving "Faby and Carlo"',
    );
  });
  it("renders resolve_entity with no text as an empty-string resolve", () => {
    expect(humanizeTool("resolve_entity", {})).toBe('Resolving ""');
  });
  it("renders read_entity with id", () => {
    expect(humanizeTool("read_entity", { type: "orders", id: "abc-1" })).toBe("Reading orders · abc-1");
  });
  it("renders traverse", () => {
    expect(humanizeTool("traverse", { from: "accounts", via: "orders" })).toBe("Traversing accounts → orders");
  });
  it("falls back to the raw tool name for unknown tools", () => {
    expect(humanizeTool("some_future_tool", {})).toBe("Running some_future_tool");
  });
});
