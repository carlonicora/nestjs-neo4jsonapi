import { describe, expect, it } from "vitest";
import { threeWayMerge } from "../three-way-merge";

const resource = (attributes: Record<string, unknown>, relationships: Record<string, unknown> = {}) => ({
  type: "npcs",
  id: "n1",
  attributes,
  relationships,
});

const block = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const rich = (...blocks: unknown[]) => JSON.stringify(blocks);

describe("threeWayMerge", () => {
  it("takes the only side that changed a field", () => {
    const result = threeWayMerge({
      base: resource({ name: "A" }),
      mine: resource({ name: "B" }),
      theirs: resource({ name: "A" }),
      richTextFields: [],
    });

    expect(result.attributes.name).toBe("B");
    expect(result.changed).toEqual(["name"]);
    expect(result.conflictFields).toEqual([]);
  });

  it("both changed a plain field to different values → conflictFields [name]", () => {
    const result = threeWayMerge({
      base: resource({ name: "A" }),
      mine: resource({ name: "B" }),
      theirs: resource({ name: "C" }),
      richTextFields: [],
    });

    expect(result.conflictFields).toEqual(["name"]);
    expect(result.changed).toEqual([]);
  });

  it("both changed it to the same value → no conflict, not in changed", () => {
    const result = threeWayMerge({
      base: resource({ name: "A" }),
      mine: resource({ name: "B" }),
      theirs: resource({ name: "B" }),
      richTextFields: [],
    });

    expect(result.conflictFields).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.attributes.name).toBe("B");
  });

  it("a field only theirs changed is not in changed", () => {
    const result = threeWayMerge({
      base: resource({ name: "A", level: 1 }),
      mine: resource({ name: "A", level: 1 }),
      theirs: resource({ name: "A", level: 2 }),
      richTextFields: [],
    });

    expect(result.changed).toEqual([]);
    expect(result.attributes.level).toBe(2);
  });

  it("merges edits to different blocks", () => {
    const result = threeWayMerge({
      base: resource({ description: rich(block("b1", "one"), block("b2", "two")) }),
      mine: resource({ description: rich(block("b1", "one (mine)"), block("b2", "two")) }),
      theirs: resource({ description: rich(block("b1", "one"), block("b2", "two (theirs)")) }),
      richTextFields: ["description"],
    });

    expect(result.conflictFields).toEqual([]);
    expect(result.changed).toEqual(["description"]);
    expect(typeof result.attributes.description).toBe("string");
    expect(JSON.parse(result.attributes.description as string)).toEqual([
      block("b1", "one (mine)"),
      block("b2", "two (theirs)"),
    ]);
  });

  it("the same block changed on both sides → conflictBlocks {description: [b1]}, description in conflictFields, the rest of the field still merged", () => {
    const result = threeWayMerge({
      base: resource({ description: rich(block("b1", "one"), block("b2", "two")) }),
      mine: resource({ description: rich(block("b1", "one (mine)"), block("b2", "two (mine)")) }),
      theirs: resource({ description: rich(block("b1", "one (theirs)"), block("b2", "two")) }),
      richTextFields: ["description"],
    });

    expect(result.conflictFields).toEqual(["description"]);
    expect(result.conflictBlocks).toEqual({ description: ["b1"] });
    expect(JSON.parse(result.attributes.description as string)).toEqual([
      block("b1", "one (theirs)"),
      block("b2", "two (mine)"),
    ]);
  });

  it("a block added on one side lands after its preceding block", () => {
    const result = threeWayMerge({
      base: resource({ description: rich(block("b1", "one"), block("b2", "two")) }),
      mine: resource({ description: rich(block("b1", "one"), block("n1", "new"), block("b2", "two")) }),
      theirs: resource({ description: rich(block("b1", "one"), block("b2", "two (theirs)")) }),
      richTextFields: ["description"],
    });

    expect(JSON.parse(result.attributes.description as string).map((b: { id: string }) => b.id)).toEqual([
      "b1",
      "n1",
      "b2",
    ]);
  });

  it("a block removed on one side and untouched on the other is removed", () => {
    const result = threeWayMerge({
      base: resource({ description: rich(block("b1", "one"), block("b2", "two")) }),
      mine: resource({ description: rich(block("b1", "one")) }),
      theirs: resource({ description: rich(block("b1", "one"), block("b2", "two")) }),
      richTextFields: ["description"],
    });

    expect(JSON.parse(result.attributes.description as string)).toEqual([block("b1", "one")]);
    expect(result.changed).toEqual(["description"]);
  });

  it("to-many relationship ids added or removed on only one side are applied", () => {
    const ids = (...list: string[]) => ({ data: list.map((id) => ({ type: "factions", id })) });

    const result = threeWayMerge({
      base: resource({}, { factions: ids("f1", "f2") }),
      mine: resource({}, { factions: ids("f1", "f3") }),
      theirs: resource({}, { factions: ids("f1", "f2", "f4") }),
      richTextFields: [],
    });

    expect(result.changed).toEqual(["factions"]);
    expect(result.relationships.factions).toEqual(ids("f1", "f4", "f3"));
    expect(result.conflictFields).toEqual([]);
  });

  it("an unchanged to-many relationship is not in changed", () => {
    const ids = (...list: string[]) => ({ data: list.map((id) => ({ type: "factions", id })) });

    const result = threeWayMerge({
      base: resource({}, { factions: ids("f1") }),
      mine: resource({}, { factions: ids("f1") }),
      theirs: resource({}, { factions: ids("f1", "f2") }),
      richTextFields: [],
    });

    expect(result.changed).toEqual([]);
  });

  it("a block order changed only on the device is written with the device's order", () => {
    const result = threeWayMerge({
      base: resource({ description: rich(block("b1", "one"), block("b2", "two")) }),
      mine: resource({ description: rich(block("b2", "two"), block("b1", "one")) }),
      theirs: resource({ description: rich(block("b1", "one (theirs)"), block("b2", "two")) }),
      richTextFields: ["description"],
    });

    expect(result.conflictFields).toEqual([]);
    expect(result.changed).toEqual(["description"]);
    expect(JSON.parse(result.attributes.description as string)).toEqual([
      block("b2", "two"),
      block("b1", "one (theirs)"),
    ]);
  });

  it("both sides ordering the blocks differently is a field conflict", () => {
    const result = threeWayMerge({
      base: resource({ description: rich(block("b1", "one"), block("b2", "two"), block("b3", "three")) }),
      mine: resource({ description: rich(block("b3", "three"), block("b1", "one"), block("b2", "two")) }),
      theirs: resource({ description: rich(block("b2", "two"), block("b1", "one"), block("b3", "three")) }),
      richTextFields: ["description"],
    });

    expect(result.conflictFields).toEqual(["description"]);
    expect(result.changed).toEqual([]);
  });

  const link = (id: string, meta?: Record<string, unknown>) => ({ type: "factions", id, ...(meta ? { meta } : {}) });

  it("edge props changed only on the device are applied", () => {
    const result = threeWayMerge({
      base: resource({}, { factions: { data: [link("f1", { role: "ally" })] } }),
      mine: resource({}, { factions: { data: [link("f1", { role: "enemy" })] } }),
      theirs: resource({}, { factions: { data: [link("f1", { role: "ally" })] } }),
      richTextFields: [],
    });

    expect(result.changed).toEqual(["factions"]);
    expect(result.relationships.factions).toEqual({ data: [link("f1", { role: "enemy" })] });
  });

  it("edge props changed only on the server are kept and not written", () => {
    const result = threeWayMerge({
      base: resource({}, { factions: { data: [link("f1", { role: "ally" })] } }),
      mine: resource({}, { factions: { data: [link("f1", { role: "ally" })] } }),
      theirs: resource({}, { factions: { data: [link("f1", { role: "rival" })] } }),
      richTextFields: [],
    });

    expect(result.changed).toEqual([]);
    expect(result.conflictFields).toEqual([]);
  });

  it("to-one edge props in relationship meta changed only on the device are applied", () => {
    const one = (meta: Record<string, unknown>) => ({ data: { type: "locations", id: "l1" }, meta });
    const result = threeWayMerge({
      base: resource({}, { location: one({ position: 1 }) }),
      mine: resource({}, { location: one({ position: 2 }) }),
      theirs: resource({}, { location: one({ position: 1 }) }),
      richTextFields: [],
    });

    expect(result.changed).toEqual(["location"]);
    expect(result.relationships.location).toEqual({
      data: { type: "locations", id: "l1", meta: { position: 2 } },
      meta: { position: 2 },
    });
  });

  it("both sides changing the same link's props differently is not a conflict: the device's props win", () => {
    const result = threeWayMerge({
      base: resource({}, { factions: { data: [link("f1", { role: "ally" })] } }),
      mine: resource({}, { factions: { data: [link("f1", { role: "enemy" })] } }),
      theirs: resource({}, { factions: { data: [link("f1", { role: "rival" })] } }),
      richTextFields: [],
    });

    expect(result.conflictFields).toEqual([]);
    expect(result.changed).toEqual(["factions"]);
    expect(result.relationships.factions).toEqual({ data: [link("f1", { role: "enemy" })] });
  });

  it("a known relationship the server omits is empty: a link the server removed does not come back", () => {
    const result = threeWayMerge({
      base: resource({}, { location: { data: { type: "locations", id: "l1" } } }),
      mine: resource({ name: "B" }, { location: { data: { type: "locations", id: "l1" } } }),
      theirs: resource({}, {}),
      richTextFields: [],
      knownRelationships: ["location"],
    });

    expect(result.relationships.location).toEqual({ data: null });
    expect(result.changed).toEqual(["name"]);
  });

  it("an unknown relationship the server omits keeps the base semantics", () => {
    const result = threeWayMerge({
      base: resource({}, { location: { data: { type: "locations", id: "l1" } } }),
      mine: resource({}, { location: { data: { type: "locations", id: "l1" } } }),
      theirs: resource({}, {}),
      richTextFields: [],
    });

    expect(result.changed).toEqual([]);
  });

  it("a resolution settles each conflicting field by its choice; non-conflicting fields merge normally", () => {
    const result = threeWayMerge({
      base: resource({ name: "A", level: 1, title: "T", tag: "x", mood: "calm" }),
      mine: resource({ name: "B", level: 1, title: "Tm", tag: "xm", mood: "calm" }),
      theirs: resource({ name: "C", level: 2, title: "Tt", tag: "xt", mood: "angry" }),
      richTextFields: [],
      resolution: {
        choices: { name: "mine", title: "theirs", tag: "merged" },
        merged: { attributes: { tag: "x-merged" } },
      },
    });

    expect(result.conflictFields).toEqual([]);
    expect(result.changed.sort()).toEqual(["name", "tag"]);
    expect(result.attributes).toEqual({ name: "B", level: 2, title: "Tt", tag: "x-merged", mood: "angry" });
  });

  it("a rich-text conflict follows the field's choice block by block", () => {
    const result = threeWayMerge({
      base: resource({ description: rich(block("b1", "one"), block("b2", "two")) }),
      mine: resource({ description: rich(block("b1", "one (mine)"), block("b2", "two")) }),
      theirs: resource({ description: rich(block("b1", "one (theirs)"), block("b2", "two (theirs)")) }),
      richTextFields: ["description"],
      resolution: { all: "mine" },
    });

    expect(result.conflictFields).toEqual([]);
    expect(JSON.parse(result.attributes.description as string)).toEqual([
      block("b1", "one (mine)"),
      block("b2", "two (theirs)"),
    ]);
    expect(result.changed).toEqual(["description"]);
  });
});
