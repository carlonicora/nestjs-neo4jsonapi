import { describe, expect, it } from "vitest";
import { mergeBlocks } from "../merge-blocks";

const block = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

describe("mergeBlocks", () => {
  it("merges edits to different blocks", () => {
    const base = [block("b1", "one"), block("b2", "two")];
    const mine = [block("b1", "one (mine)"), block("b2", "two")];
    const theirs = [block("b1", "one"), block("b2", "two (theirs)")];

    const result = mergeBlocks({ base, mine, theirs });

    expect(result.merged).toEqual([block("b1", "one (mine)"), block("b2", "two (theirs)")]);
    expect(result.conflictBlockIds).toEqual([]);
  });

  it("the same block changed on both sides is a conflict, the rest still merged", () => {
    const base = [block("b1", "one"), block("b2", "two")];
    const mine = [block("b1", "one (mine)"), block("b2", "two (mine)")];
    const theirs = [block("b1", "one (theirs)"), block("b2", "two")];

    const result = mergeBlocks({ base, mine, theirs });

    expect(result.conflictBlockIds).toEqual(["b1"]);
    expect(result.merged).toEqual([block("b1", "one (theirs)"), block("b2", "two (mine)")]);
  });

  it("the same change on both sides is no conflict", () => {
    const base = [block("b1", "one")];
    const mine = [block("b1", "same")];
    const theirs = [block("b1", "same")];

    expect(mergeBlocks({ base, mine, theirs })).toEqual({
      merged: [block("b1", "same")],
      conflictBlockIds: [],
      orderConflict: false,
    });
  });

  it("a block added on one side lands after its preceding block", () => {
    const base = [block("b1", "one"), block("b2", "two")];
    const mine = [block("b1", "one"), block("n1", "new"), block("n2", "newer"), block("b2", "two")];
    const theirs = [block("b0", "zero"), block("b1", "one"), block("b2", "two")];

    const result = mergeBlocks({ base, mine, theirs });

    expect(result.merged.map((b) => b.id)).toEqual(["b0", "b1", "n1", "n2", "b2"]);
    expect(result.conflictBlockIds).toEqual([]);
  });

  it("a block added at the start lands first", () => {
    const base = [block("b1", "one")];
    const mine = [block("n1", "new"), block("b1", "one")];
    const theirs = [block("b1", "one")];

    expect(mergeBlocks({ base, mine, theirs }).merged.map((b) => b.id)).toEqual(["n1", "b1"]);
  });

  it("a block removed on one side and untouched on the other is removed", () => {
    const base = [block("b1", "one"), block("b2", "two"), block("b3", "three")];
    const mine = [block("b1", "one"), block("b3", "three")];
    const theirs = [block("b1", "one"), block("b2", "two"), block("b3", "three (theirs)")];

    const result = mergeBlocks({ base, mine, theirs });

    expect(result.merged).toEqual([block("b1", "one"), block("b3", "three (theirs)")]);
    expect(result.conflictBlockIds).toEqual([]);
  });

  it("a block removed by theirs and untouched by mine stays removed", () => {
    const base = [block("b1", "one"), block("b2", "two")];
    const mine = [block("b1", "one"), block("b2", "two")];
    const theirs = [block("b1", "one")];

    expect(mergeBlocks({ base, mine, theirs })).toEqual({
      merged: [block("b1", "one")],
      conflictBlockIds: [],
      orderConflict: false,
    });
  });

  it("a block removed on one side and changed on the other is a conflict", () => {
    const base = [block("b1", "one"), block("b2", "two")];
    const mine = [block("b1", "one")];
    const theirs = [block("b1", "one"), block("b2", "two (theirs)")];

    const result = mergeBlocks({ base, mine, theirs });

    expect(result.conflictBlockIds).toEqual(["b2"]);
    expect(result.merged).toEqual(theirs);
  });

  it("only the device moved blocks → the device's order, the server's edits kept", () => {
    const base = [block("b1", "one"), block("b2", "two"), block("b3", "three")];
    const mine = [block("b3", "three"), block("b1", "one"), block("b2", "two")];
    const theirs = [block("b1", "one"), block("b2", "two (theirs)"), block("b3", "three")];

    const result = mergeBlocks({ base, mine, theirs });

    expect(result.merged).toEqual([block("b3", "three"), block("b1", "one"), block("b2", "two (theirs)")]);
    expect(result.conflictBlockIds).toEqual([]);
    expect(result.orderConflict).toBe(false);
  });

  it("only the server moved blocks → the server's order, the device's edits kept", () => {
    const base = [block("b1", "one"), block("b2", "two")];
    const mine = [block("b1", "one (mine)"), block("b2", "two")];
    const theirs = [block("b2", "two"), block("b1", "one")];

    expect(mergeBlocks({ base, mine, theirs }).merged).toEqual([block("b2", "two"), block("b1", "one (mine)")]);
  });

  it("both moved blocks into different orders → orderConflict, the server's order kept", () => {
    const base = [block("b1", "one"), block("b2", "two"), block("b3", "three")];
    const mine = [block("b3", "three"), block("b1", "one"), block("b2", "two")];
    const theirs = [block("b2", "two"), block("b1", "one"), block("b3", "three")];

    const result = mergeBlocks({ base, mine, theirs });

    expect(result.orderConflict).toBe(true);
    expect(result.merged.map((b) => b.id)).toEqual(["b2", "b1", "b3"]);
  });

  it("prefer mine resolves every conflict to the device's side", () => {
    const base = [block("b1", "one"), block("b2", "two"), block("b3", "three")];
    const mine = [block("b3", "three (mine)"), block("b1", "one (mine)")];
    const theirs = [block("b2", "two (theirs)"), block("b1", "one (theirs)")];

    const result = mergeBlocks({ base, mine, theirs, prefer: "mine" });

    expect(result.merged).toEqual([block("b3", "three (mine)"), block("b1", "one (mine)")]);
    expect(result.conflictBlockIds).toEqual([]);
    expect(result.orderConflict).toBe(false);
  });
});
