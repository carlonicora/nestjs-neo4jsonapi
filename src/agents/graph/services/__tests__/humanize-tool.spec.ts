import { describe, it, expect } from "vitest";
import { humanizeTool, collectEntityLabels } from "../humanize-tool";

describe("humanizeTool", () => {
  it("renders describe_entity", () => {
    expect(humanizeTool("describe_entity", { type: "orders" })).toBe("Looking up orders schema");
  });
  it("renders search_entities as a typed search (no text component)", () => {
    expect(humanizeTool("search_entities", { type: "persons" })).toBe("Searching persons");
  });
  it("renders resolve_entity with the user's literal text", () => {
    expect(humanizeTool("resolve_entity", { text: "Faby and Carlo" })).toBe('Resolving "Faby and Carlo"');
  });
  it("renders resolve_entity with no text as an empty-string resolve", () => {
    expect(humanizeTool("resolve_entity", {})).toBe('Resolving ""');
  });
  it("renders read_entity with the entity's label when it is known", () => {
    const labels = new Map([["abc-1", "Fabio"]]);
    expect(humanizeTool("read_entity", { type: "npcs", id: "abc-1" }, labels)).toBe("Reading npcs · Fabio");
  });
  it("renders read_entity without the id when no label is known", () => {
    expect(humanizeTool("read_entity", { type: "npcs", id: "b415af20-21c3-4e22-a3b5-40ffbde5a03d" })).toBe(
      "Reading npcs",
    );
  });
  it("renders traverse from the tool's real input keys", () => {
    expect(humanizeTool("traverse", { fromType: "accounts", fromId: "acc-1", relationship: "orders" })).toBe(
      "Traversing accounts → orders",
    );
  });
  it("renders traverse with the source entity's label when it is known", () => {
    const labels = new Map([["acc-1", "Acme Ltd"]]);
    expect(humanizeTool("traverse", { fromType: "accounts", fromId: "acc-1", relationship: "orders" }, labels)).toBe(
      "Traversing Acme Ltd → orders",
    );
  });
  it("falls back to the raw tool name for unknown tools", () => {
    expect(humanizeTool("some_future_tool", {})).toBe("Running some_future_tool");
  });
});

describe("collectEntityLabels", () => {
  it("harvests id → summary from a resolve_entity result", () => {
    const labels = new Map<string, string>();
    collectEntityLabels(
      { matchMode: "exact", items: [{ type: "npcs", id: "abc-1", summary: "Fabio", score: 3 }] },
      labels,
    );
    expect(labels.get("abc-1")).toBe("Fabio");
  });

  it("parses a JSON string result", () => {
    const labels = new Map<string, string>();
    collectEntityLabels(JSON.stringify({ items: [{ id: "abc-1", summary: "Fabio" }] }), labels);
    expect(labels.get("abc-1")).toBe("Fabio");
  });

  it("harvests nested related records from a read_entity result", () => {
    const labels = new Map<string, string>();
    collectEntityLabels(
      {
        id: "npc-1",
        type: "npcs",
        fields: { name: "Fabio" },
        related: { locations: [{ id: "loc-1", type: "locations", summary: "The Rusty Anchor" }] },
      },
      labels,
    );
    expect(labels.get("npc-1")).toBe("Fabio");
    expect(labels.get("loc-1")).toBe("The Rusty Anchor");
  });

  it("ignores a summary that is just the id", () => {
    const labels = new Map<string, string>();
    collectEntityLabels({ items: [{ id: "abc-1", summary: "abc-1" }] }, labels);
    expect(labels.has("abc-1")).toBe(false);
  });

  it("keeps the first label seen for an id", () => {
    const labels = new Map<string, string>();
    collectEntityLabels({ items: [{ id: "abc-1", summary: "Fabio" }] }, labels);
    collectEntityLabels({ items: [{ id: "abc-1", summary: "Fabio the Grim" }] }, labels);
    expect(labels.get("abc-1")).toBe("Fabio");
  });

  it("tolerates a non-JSON string result", () => {
    const labels = new Map<string, string>();
    expect(() => collectEntityLabels("not json at all", labels)).not.toThrow();
    expect(labels.size).toBe(0);
  });
});
