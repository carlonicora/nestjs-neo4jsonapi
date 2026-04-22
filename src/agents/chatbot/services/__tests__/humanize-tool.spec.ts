import { describe, it, expect } from "vitest";
import { humanizeTool } from "../humanize-tool";

describe("humanizeTool", () => {
  it("renders describe_entity", () => {
    expect(humanizeTool("describe_entity", { type: "orders" })).toBe("Looking up orders schema");
  });
  it("renders search_entities with text", () => {
    expect(humanizeTool("search_entities", { type: "persons", text: "Acme" })).toBe('Searching persons for "Acme"');
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
